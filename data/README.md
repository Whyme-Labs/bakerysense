# Data

## Layout

- `raw/` — original datasets, never modified. Gitignored.
- `processed/` — feature-engineered parquet files. Gitignored.
- `interim/` — intermediate artefacts (train/test splits, etc.). Gitignored.

## Datasets

### French Bakery (Kaggle) — demo dataset

234k transactions, 2021-2022, one French bakery. Realistic perishable-retail signal.

```bash
# Requires Kaggle API credentials (~/.kaggle/kaggle.json)
kaggle datasets download -d matthieugimbert/french-bakery-daily-sales -p data/raw --unzip
```

Expected file: `data/raw/Bakery_Sales.csv`.

### Synthetic fallback

If no raw dataset is present, `bakerysense.data.load_bakery()` generates a 2-year synthetic bakery with:

- 12 SKUs (croissant, baguette, pain au chocolat, pandan bun, curry puff, …)
- Realistic day-of-week weights, month-of-year seasonality, holiday spikes
- Weather-sensitive items (iced drinks, hot soups)
- Per-SKU noise appropriate to the mean

This lets the full pipeline run with no external data — useful for CI and for day-1 verification.

### Client data (live engagement)

Handled via a private data-sharing agreement. Never committed. Place exports at `data/raw/client/` (gitignored, symlinks also fine).
