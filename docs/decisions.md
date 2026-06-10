# Architecture Decision Records

## ADR-001 — Signature algorithmique : Ed25519 via @noble/curves

**Contexte** : chaque événement maritime doit être signé à la création pour garantir l'immuabilité.

**Options** :
- secp256k1 (même courbe qu'Ethereum, vérifiable nativement on-chain)
- Ed25519 (@noble/curves, standard W3C VC, plus rapide)

**Choix** : Ed25519. Pure-JS, audité, aucune dépendance native. La vérification on-chain n'est pas un objectif MVP ; si elle le devient, un contrat de vérification Ed25519 est disponible (EIP-665 ou bibliothèques EVM).

**Conséquences** : la signature n'est pas vérifiable directement dans MerkleAnchor.sol (qui ne stocke que la racine Merkle). La vérification ed25519 reste off-chain.

---

## ADR-002 — Arbre de Merkle : SHA-256 en tests, keccak256 en production

**Contexte** : les feuilles doivent être vérifiables en Solidity (`keccak256`), mais SHA-256 est natif en Node.js (pas de dépendance externe).

**Choix** : SHA-256 dans `packages/core` (tests, replay), keccak256 dans `apps/anchor-worker` (ancrage réel). Le contrat Solidity utilise `keccak256`. La fonction `hashLeaf` est factorisée pour permettre le swap.

**Conséquences** : les preuves générées en mode replay (demo.ts + Anvil) utilisent SHA-256 ; les preuves on Base Sepolia utilisent keccak256. Le format de preuve retourné par l'API indique le mode (`hashAlgo`).

---

## ADR-003 — IDs d'événements : UUIDv7 préfixé `evt_`

**Contexte** : les IDs doivent être uniques, triables temporellement et lisibles.

**Choix** : UUIDv7 (time-ordered) avec préfixe `evt_`. Génération via `crypto.randomUUID()` (Node 19+) avec timestamp en tête pour le tri naturel.

**Conséquences** : tri par ID ≈ tri par création ; pas besoin d'index supplémentaire sur `created_at` pour les requêtes paginées chronologiquement.

---

## ADR-004 — État FSM : mémoire + snapshot DB

**Contexte** : la machine à états doit survivre aux redémarrages de l'ingestor.

**Choix** : état en mémoire (Map<mmsi, VesselStateMachine>), snapshot dans la table `vessel_states` à chaque transition. Au démarrage, rechargement des states depuis DB.

**Conséquences** : pas de replay complet de l'historique AIS au redémarrage ; un navire dont le dernier état est MOORED depuis >24h est marqué STALE et réinitialisé à UNKNOWN.

---

## ADR-005 — Hystérésis : médiane glissante sur fenêtre temporelle

**Contexte** : les messages AIS terrestres contiennent parfois des pics de vitesse parasites (erreur GPS momentanée).

**Choix** : médiane des vitesses sur la fenêtre de détection (20 min pour arrivée, 10 min pour départ) plutôt que valeur instantanée. Seuil de couverture : 80% de la durée doit être représentée.

**Conséquences** : résistance aux outliers AIS mais latence de détection de 10-20 min incompressible (voulu).

---

## ADR-006 — Podman au lieu de Docker

**Contexte** : environnement Linux (Ubuntu), besoin d'isolation pour TimescaleDB + Anvil.

**Choix** : Podman (rootless) + `podman compose`. Même format docker-compose.yml. Healthcheck explicite sur TimescaleDB pour que `depends_on: condition: service_healthy` fonctionne avec Podman 4+.

**Conséquences** : `podman compose up` et `docker compose up` sont tous deux supportés par le même fichier.
