# EDF Tempo (`edf-tempo@aubin`)

## English Notice (french version below)

This desklet addresses a **France-specific** use case: it is designed for French households subscribed to **EDF's "Tempo" electricity tariff**, whose daily color signals (`Blue`, `White`, `Red`) are published each morning around 11:00 CET by **RTE** (*Réseau de Transport d'Électricité*, the French electricity transmission system operator). Unless you use the French EDF Tempo tariff (or monitor the French power grid's Tempo signal), this desklet will not be relevant to your region.

It queries the official **RTE** Open API (*Tempo Like Supply Contract*, OAuth2) directly over HTTPS — with no third-party relay and no external CLI dependency — to display tomorrow's (and optionally today's) Tempo color on your Cinnamon desktop.

### How to create an RTE account and get API credentials

1. **Create a free RTE account:**
   - Go to the [RTE Data Portal](https://data.rte-france.com/), click **Sign in** (*Se connecter*) in the top-right corner, then **Create an account** (*Créer un compte*).
   - Fill out the registration form (free and open to individuals), accept the terms of use, and click the confirmation link sent by email *(account activation may take a few minutes)*.
2. **Subscribe to the API and create an application:**
   - Open the **API Catalog** (*Catalogue d'API*), search for **Tempo Like Supply Contract**, and click **Subscribe to API** (*Abonnez-vous à l'API*).
   - Create a new application of type **Web / Server** (*Web / Serveur*, OAuth2 Client Credentials flow) and link it to **Tempo Like Supply Contract**.
3. **Copy your Base64 credentials:**
   - Open **My applications** (*Mes applications*), select your application, and click **Copy in base 64** (*Copier en base 64*) to copy your Base64-encoded `client_id:client_secret` string.
4. **Configure the desklet:**
   - Right-click the desklet → **Configure...**, then either select a `.env` file (`RTE_CREDENTIALS_BASE64=...`) / single-line Base64 secret file *(press `Ctrl+H` in the GTK file dialog to show hidden files like `.env`)*, or paste the Base64 string directly.

---

## Français

Ce desklet répond à un besoin **spécifique à la France** : il s'adresse aux abonnés à l'offre **EDF Tempo** et affiche sur le bureau Cinnamon la couleur tarifaire du **lendemain** (`Bleu`, `Blanc`, `Rouge`, ou `En attente` avant la publication quotidienne vers 11 h), ainsi qu'optionnellement celle du **jour en cours**.

Les données sont récupérées auprès de l'API officielle de **RTE** (*Tempo Like Supply Contract*, OAuth2), sans passer par un service tiers ni dépendance externe.

### Créer un compte RTE et récupérer ses identifiants API

1. **Créer un compte gratuit sur le portail RTE :**
   - Rendez-vous sur [data.rte-france.com](https://data.rte-france.com/), cliquez sur **Se connecter** (en haut à droite) puis sur **Créer un compte**.
   - Remplissez le formulaire d'inscription (ouvert gratuitement aux particuliers), acceptez les conditions générales d'utilisation, puis cliquez sur le lien de validation reçu par courriel *(l'activation définitive du compte peut prendre quelques minutes, soyez patients)*.
2. **S'abonner à l'API et déclarer une application :**
   - Une fois connecté, ouvrez le **Catalogue d'API**, recherchez **Tempo Like Supply Contract**, ouvrez sa fiche puis cliquez sur **Abonnez-vous à l'API**.
   - Créez une nouvelle application :
     - **Nom de l'application :** libre (par ex. `edf-tempo-desklet`),
     - **Type d'application :** choisissez **Web / Serveur** (authentification OAuth2 *Client Credentials*),
     - validez et associez cette application à l'API **Tempo Like Supply Contract**.
3. **Récupérer la clé Base64 :**
   - Ouvrez le menu **Mes applications**, cliquez sur votre application, puis cliquez sur le bouton **Copier en base 64** *(cela copie directement la chaîne `ID_Client:ID_Secret` encodée en Base64 attendue par l'API)*.
4. **Configurer le desklet :**
   - Clic droit sur le desklet → **Configurer…**, puis au choix :
     - sélectionnez un fichier `.env` contenant `RTE_CREDENTIALS_BASE64=...` ou un fichier secret d'une seule ligne contenant la clé Base64 *(appuyez sur `Ctrl+H` dans la boîte de dialogue GTK pour afficher les fichiers cachés comme `.env`)*,
     - ou collez directement la chaîne Base64 dans le champ **Identifiants OAuth2 RTE (Base64)**.
