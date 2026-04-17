# BakerySense — Live Demo Transcript

- **Model**: `ollama:gemma4:e4b-it-q4_K_M @ http://localhost:11434`
- **SKUs**: 20 — BAGUETTE, BANETTE, BANETTINE, BOULE 200G, BOULE 400G, CAMPAGNE, CEREAL BAGUETTE, COMPLET, COOKIE, COUPE, CROISSANT, ECLAIR, FICELLE, FORMULE SANDWICH, MOISSON, PAIN AU CHOCOLAT, SPECIAL BREAD, TARTELETTE, TRADITIONAL BAGUETTE, VIK BREAD
- **Forecaster coverage**: through 2022-09-30

Numeric work (forecasting, newsvendor, SHAP) runs deterministically in Python. Gemma 4 is the semantic layer: it picks tools, reads their JSON output, and renders the result as plain merchant-facing language.

## Turn 1
**Merchant:** Which products are you trained on?

_Tools invoked:_
- `list_skus -> {"skus": ["BAGUETTE", "BANETTE", "BANETTINE", "BOULE 200G", "BOULE 400G", "CAMPAGNE", "CEREAL BAGUETTE", "COMPLET", "COOKIE", "COUPE", "CROISSANT", "ECLAIR", "FICELLE", "FORMULE SANDWICH", "MOISSON", "PAIN AU CHOCOLAT", "SPECIAL BREAD", "TARTELETTE", "TRADITIONAL BAGUETTE", "VIK BREAD"]`

**BakerySense:** The forecaster is trained on the following products: BAGUETTE, BANETTE, BANETTINE, BOULE 200G, BOULE 400G, CAMPAGNE, CEREAL BAGUETTE, COMPLET, COOKIE, COUPE, CROISSANT, ECLAIR, FICELLE, FORMULE SANDWICH, MOISSON, PAIN AU CHOCOLAT, SPECIAL BREAD, TARTELETTE, TRADITIONAL BAGUETTE, and VIK BREAD.

## Turn 2
**Merchant:** How many TRADITIONAL BAGUETTE should I bake tomorrow? Use the last date available in the data.

_Tools invoked:_
- `forecast -> {"sku": "TRADITIONAL BAGUETTE", "date": "2022-09-30", "quantiles": {"q0.1": 117.6, "q0.3": 130.0, "q0.5": 130.7, "q0.6": 140.4, "q0.7": 135.1, "q0.8": 152.5, "q0.9": 148.2}, "bake_quantity": 135, "target_quantile": 0.667, "selected_quantile": 0.7, "forecaster": "lightgbm_quantile"}`

**BakerySense:** You should bake **135** TRADITIONAL BAGUETTE tomorrow. This number is based on the forecast for the last available date in the data, 2022-09-30.

## Turn 3
**Merchant:** Why that number? Explain the drivers.

_Tools invoked:_
- `explain_drivers -> {"sku": "TRADITIONAL BAGUETTE", "date": "2022-09-30", "prediction": 130.73, "base_value": 22.73, "drivers": [["lag_7", 45.558], ["rolling_mean_7", 28.908], ["lag_1", 19.344]]}`

**BakerySense:** The forecast is driven primarily by the sales from 7 days ago, which contributed 45.56 units to the prediction. Other factors include the rolling average of the last 7 days and yesterday's sales.

## Turn 4
**Merchant:** What's my waste risk on CROISSANT for that same date?

_Tools invoked:_
- `waste_risk -> {"sku": "CROISSANT", "date": "2022-09-30", "bake_quantity": 28, "threshold_pct": 10.0, "waste_probability": 0.651}`

**BakerySense:** Your waste risk for CROISSANT on 2022-09-30 is 65.1%, meaning there is a high probability that more than 10% of your unsold units will be waste.

## Turn 5
**Merchant:** At 6pm I still have 80 CROISSANT, 30 ECLAIR, and 20 TARTELETTE left. What should I mark down?

_Tools invoked:_
- `suggest_markdowns -> {"as_of": "2022-09-30", "markdowns": [{"sku": "CROISSANT", "remaining": 80, "discount_pct": 30, "reason": "inventory > q0.7 forecast + 20%"}, {"sku": "ECLAIR", "remaining": 30, "discount_pct": 30, "reason": "inventory > q0.7 forecast + 20%"}, {"sku": "TARTELETTE", "remaining": 2`

**BakerySense:** You should mark down all three items by 30%. This discount level is recommended because your remaining inventory for CROISSANT, ECLAIR, and TARTELETTE is higher than the forecast plus 20%.
