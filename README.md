# Xiaomi Air Purifier PM2.5 Logger

Logs PM2.5, temperature, and humidity from two Xiaomi air purifiers to Google Sheets every hour via GitHub Actions.

## Devices
| Name | Model |
|------|-------|
| Xiaomi Air Purifier 4 Pro | `zhimi.airp.vb4` |
| Xiaomi Air Purifier 4 | `zhimi.airpurifier.mb5` |

## Setup

### 1. Get Xiaomi tokens
```bash
pip install micloud
python -c "from micloud import MiCloud; mc = MiCloud('EMAIL','PASS'); mc.login(); print(mc.get_devices())"
```

### 2. Create Google Service Account
1. Google Cloud Console → IAM → Service Accounts → Create
2. Create JSON key → download
3. Share the target Google Sheet with the service account email

### 3. Set GitHub Secrets
| Secret | Value |
|--------|-------|
| `XIAOMI_EMAIL` | Mi Home account email |
| `XIAOMI_PASSWORD` | Mi Home account password |
| `GCP_SA_KEY` | Full contents of the service account JSON file |
| `SHEET_ID` | Google Sheet ID (from the URL) |

### 4. Push to GitHub
GitHub Actions will run automatically every hour.

## Google Sheet columns
`timestamp | device | pm25 | temperature | humidity | mode`
