# Model Evaluation Documentation

## Overview

This document describes the forecasting model used in Forgetting Forecast, its assumptions, evaluation methodology, and validation status.

## Current Model: Exponential Half-Life v1

### Model Definition

The model estimates recall probability using an exponential decay function:

```
P(recall at time t) = 0.5 ^ (elapsed_hours / estimated_half_life_hours) × difficulty_adjustment
```

Where:
- `elapsed_hours` = hours since last successful review (or concept creation)
- `estimated_half_life_hours` = model's current estimate of the concept's half-life
- `difficulty_adjustment` = 1 - (difficulty - 1) × 0.035

### Half-Life Update Rule

After each review, the half-life is updated multiplicatively:

```
new_half_life = old_half_life × outcome_factor × speed_factor × confidence_factor × difficulty_factor
```

| Factor | Correct Recall | Incorrect Recall |
|--------|----------------|------------------|
| **Outcome Factor** | 1.55 | 0.42 |
| **Speed Factor** | clamp(1.15 - log₂(latency_seconds + 1) / 8, 0.65, 1.1) | Same |
| **Confidence Factor** | 0.88 + confidence × 0.32 | 0.55 + (1 - confidence) × 0.22 |
| **Difficulty Factor** | 1 - (difficulty - 1) × 0.045 | Same |

### Constraints
- Half-life clamped to [0.75 hours, 1 year]
- Probability clamped to [0.01, 0.99]
- Minimum half-life: 0.5 hours

## Model Assumptions

1. **Exponential Forgetting**: Memory decays exponentially with time (Ebbinghaus-style)
2. **Half-Life Representation**: Each concept has a single half-life parameter
3. **Difficulty as Prior**: Harder concepts start with lower baseline recall
4. **Multiplicative Updates**: Review outcomes multiplicatively adjust half-life
5. **Latency as Proficiency Signal**: Faster responses indicate stronger memory
6. **Confidence Calibration**: Self-reported confidence modulates update magnitude
7. **Independence**: Concepts are modeled independently (no interference)

## Scheduling Policy

### Review Priority Calculation

Items are prioritized for the review queue using:

```
priority_score = (1 - recall_probability) + overdue_bonus + uncertainty_bonus
```

Where:
- `recall_probability`: Current model estimate (lower = higher priority)
- `overdue_bonus`: 0.3 if `next_review_at ≤ now`, else 0
- `uncertainty_bonus`: 0.2 if `repetition_count < 3`, 0.1 if `repetition_count < 10` or `hours_since_review > 2×half_life`, else 0

### Queue Ordering
```
ORDER BY
  CASE WHEN next_review_at ≤ NOW() THEN 0 ELSE 1 END,  -- Overdue first
  last_predicted_recall_probability ASC,               -- Lower recall first
  next_review_at ASC                                   -- Soonest due first
```

## Evaluation Metrics

### Primary Metrics

| Metric | Description | Target |
|--------|-------------|--------|
| **Brier Score** | Mean squared error of probability predictions | < 0.25 |
| **Log Loss** | Negative log-likelihood of outcomes | < 0.7 |
| **Calibration Error** | |Observed - Predicted| by probability bin | < 0.1 |
| **AUC-ROC** | Discrimination between correct/incorrect | > 0.7 |

### Secondary Metrics

| Metric | Description |
|--------|-------------|
| **Recall@1** | Accuracy of top-1 predicted "due" item |
| **Time to Mastery** | Reviews needed to reach 90% recall probability |
| **Reviews per Retained Item** | Efficiency measure |
| **Study Time per Session** | User engagement |

## Evaluation Methodology

### Data Splits

To prevent data leakage, evaluations use **time-based splits**:

```
Training:   Reviews from t₀ to t₁
Validation: Reviews from t₁ to t₂  
Test:       Reviews from t₂ to t₃
```

Where `t₁ - t₀ ≥ 2 weeks`, `t₂ - t₁ ≥ 1 week`, `t₃ - t₂ ≥ 1 week`.

### Per-Learner Splits

For multi-user evaluation, split by user:
- Train on 70% of users
- Validate on 15% of users
- Test on 15% of users

### Per-Concept Splits

For concept-level generalization:
- Train on concepts from certain subjects
- Test on held-out subjects

## Baselines for Comparison

### 1. Fixed Interval
Review every N days (N = 1, 3, 7, 14) regardless of performance.

### 2. Leitner System
- Box 1: Daily
- Box 2: Every 3 days
- Box 3: Weekly
- Box 4: Bi-weekly
- Box 5: Monthly
- Correct → promote, Incorrect → demote to Box 1

### 3. SM-2 (SuperMemo 2)
- Interval multipliers based on ease factor
- Ease factor updated by response quality (0-5)

### 4. Random
Random concept selection (lower bound)

## Current Validation Status

### ✅ Unit Tests (Passing)
- Recall probability decreases with time
- Correct reviews increase half-life
- Incorrect reviews decrease half-life
- Forecast returns valid probability and status
- Future forecast doesn't increase recall without review

### ❌ Calibration Testing (Not Yet Done)
- **Required**: Delayed outcome collection on held-out concepts
- **Required**: Brier score computation on test set
- **Required**: Reliability diagrams (predicted vs observed)
- **Required**: Comparison against baselines

### ❌ Efficiency Testing (Not Yet Done)
- **Required**: A/B test adaptive vs fixed interval
- **Required**: Recall per study minute measurement
- **Required**: Time-to-mastery comparison

## Data Requirements for Validation

### Minimum Viable Evaluation
- **Users**: ≥ 20 active learners
- **Concepts**: ≥ 100 unique concepts
- **Reviews**: ≥ 500 total review attempts
- **Time span**: ≥ 4 weeks of data
- **Delayed outcomes**: ≥ 100 concepts tested after controlled delays (1, 3, 7, 14 days)

### Ideal Evaluation
- **Users**: ≥ 100 learners
- **Concepts**: ≥ 500 unique concepts across subjects
- **Reviews**: ≥ 5000 total attempts
- **Time span**: ≥ 12 weeks
- **Diverse subjects**: STEM, humanities, languages
- **Controlled delays**: Systematic delayed testing protocol

## Known Limitations

### Model Limitations
1. **No Interference Modeling**: Concepts don't affect each other
2. **Single Half-Life**: Doesn't distinguish storage vs retrieval strength
3. **No Context Effects**: Ignores time of day, mood, environment
4. **Heuristic Coefficients**: Not optimized on real data
5. **No Individual Differences**: Same update rules for all learners

### Data Limitations
1. **Self-Reported Grades**: Subject to bias
2. **No Ground Truth**: Can't verify actual memory state
3. **Selection Bias**: Users choose what to review
4. **Missing Data**: Lapsed concepts may be archived

## Reproducible Evaluation

### Running Evaluation
```bash
# 1. Export data
npm run db:export -- --format=json --output=data.json

# 2. Run evaluation script
node scripts/evaluate.js --data=data.json --split=time --test-start=2026-09-01

# 3. Generate report
node scripts/evaluate.js --report=html --output=evaluation-report.html
```

### Evaluation Script Outputs
- Brier score with 95% CI
- Calibration plot (reliability diagram)
- ROC curve
- Comparison table vs baselines
- Per-subject breakdown
- Failure case analysis

## Model Versioning

| Version | Description | Status |
|---------|-------------|--------|
| `exponential-half-life-v1` | Current baseline | Active |
| `fsrs-v1` | Free Spaced Repetition Scheduler | Planned |
| `hierarchical-v1` | Multi-level (storage/retrieval strength) | Research |

### Version Compatibility
- All predictions tagged with `model_version`
- Historical predictions never recomputed
- Migration path for state upgrades

## Ethical Considerations

1. **No Medical Claims**: Not a diagnostic tool
2. **Transparency**: Model limitations clearly communicated
3. **User Control**: Users can disable adaptive scheduling
4. **Data Ownership**: Users own their data, can export/delete
5. **No Dark Patterns**: No manipulative engagement tactics

## Future Work

### Short Term (1-2 months)
- [ ] Collect delayed outcomes from beta users
- [ ] Implement calibration evaluation pipeline
- [ ] Run baseline comparison (Leitner, SM-2, Fixed)
- [ ] Publish calibration report

### Medium Term (3-6 months)
- [ ] Implement FSRS engine
- [ ] A/B test adaptive vs fixed scheduling
- [ ] Add individual learner parameters
- [ ] Implement model selection (choose best per user)

### Long Term (6+ months)
- [ ] Hierarchical Bayesian model
- [ ] Cross-concept interference modeling
- [ ] Context-aware scheduling (time, device, location)
- [ ] Federated learning for privacy-preserving model improvement

## References

1. Ebbinghaus, H. (1885). *Memory: A Contribution to Experimental Psychology*
2. Wozniak, P. (1990). *Optimization of repetition spacing in the practice of learning*
3. Settles, B., & Meeder, B. (2016). *A Trainable Spaced Repetition Model for Language Learning*
4. Tabibian, B., et al. (2019). *Enhancing Human Learning via Spaced Repetition Optimization*
5. Khajah, M., et al. (2016). *Adaptive Spaced Repetition for Improving Long-Term Retention*

## Changelog

| Date | Version | Changes |
|------|---------|---------|
| 2026-10-11 | 0.1.0 | Initial baseline model documented |