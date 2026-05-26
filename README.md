# spinal-organ-connector-parking-schick

Connecteur Spinal BOS pour l'API REST Schick Signal-Park (WebSP).

---

## Fonctionnement

```mermaid
sequenceDiagram
    participant PM2 as PM2 / index.js
    participant SVC as SyncService
    participant HUB as SpinalHub (BOS)
    participant API as Schick API

    rect rgb(220, 235, 255)
        Note over PM2,API: ── PHASE INIT (1 seule fois au démarrage) ──
        PM2->>SVC: init()
        Note over SVC,HUB: boot() — charge config + graph
        SVC->>HUB: load(configPath) → OrganConfigModel
        SVC->>HUB: load(digitalTwinPath) → SpinalGraph
        SVC->>HUB: nwService.init() → crée contexte + réseau virtuel si absent
        Note over SVC,HUB: initGroups() — crée ou retrouve les 2 groupes
        SVC->>HUB: createNewBmsDevice("Parkings") si absent
        SVC->>HUB: createNewBmsDevice("Spaces") si absent
        Note over SVC,HUB: loadExisting — recharge les devices déjà en BOS
        SVC->>HUB: parkingsGroup.getChildren → parkingCache
        SVC->>HUB: spacesGroup.getChildren → spaceCache
        Note over SVC,API: initParkings() + initSpaces()
        SVC->>API: GET /WebSP/token
        SVC->>API: GET /WebSP/api/parkings
        API-->>SVC: [{type, id, name, categoriesInfo[]}, ...]
        loop chaque parking
            SVC->>HUB: createNewBmsDevice + endpoints si nouveau
            SVC->>HUB: setEndpointValue (valeurs initiales)
        end
        SVC->>API: GET /WebSP/api/Spaces
        API-->>SVC: [{id, name}, ...] × 213
        loop chaque space
            SVC->>HUB: createNewBmsDevice + 3 endpoints si nouveau
        end
    end

    rect rgb(220, 255, 220)
        Note over PM2,API: ── BOUCLE RUN (toutes les 10 s) ──
        loop toutes les 10 s
            SVC->>API: GET /WebSP/api/parkings
            SVC->>HUB: setEndpointValue × N parkings
            SVC->>API: GET /WebSP/api/SpacesState
            SVC->>HUB: setEndpointValue(state) × 213
            SVC->>API: GET /WebSP/api/SpacesClosure
            SVC->>HUB: setEndpointValue(closed) × 213
            SVC->>API: GET /WebSP/api/SpacesReservation
            SVC->>HUB: setEndpointValue(reserved) × 213
        end
    end
```

---

## Structure BOS

```
Virtual Network Parking Schick
├── Parkings
│   └── {type}_{id}_{name}   ex: site_1_Schick LABO
│       endpoints: closed, reserved, ledOff, counted,
│                  totalCapacity, totalOccupied, totalVacant, totalAvailable,
│                  fillingRate, cat_{key}_capacity … cat_{key}_departures
└── Spaces
    └── space_{id}_{name}    ex: space_6_1 - 001
        endpoints: state, closed, reserved
```

---

## Installation

```bash
cp .env.example .env && nano .env
spinalcom-utils i
npm install
npm run build
```

## Démarrage

```bash
pm2 start ecosystem.config.js && pm2 save
```

---

## Variables d'environnement

| Variable | Obligatoire | Description |
|----------|-------------|-------------|
| `SPINAL_USER_ID` | oui | ID utilisateur SpinalHub |
| `SPINAL_PASSWORD` | oui | Mot de passe SpinalHub |
| `SPINALHUB_IP` | oui | Adresse du SpinalHub |
| `SPINALHUB_PORT` | oui | Port du SpinalHub |
| `CLIENT_BASE_URL` | oui | URL base API Schick |
| `CLIENT_USER` | oui | Utilisateur API Schick |
| `CLIENT_PASSWORD` | oui | Mot de passe API Schick |
| `PULL_INTERVAL` | non (10000) | Intervalle de polling en ms |
| `NETWORK_NAME` | non | Nom du contexte réseau BMS |
| `VIRTUAL_NETWORK_NAME` | non | Nom du réseau virtuel |
