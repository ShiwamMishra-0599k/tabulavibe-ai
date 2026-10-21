"""Statistical building blocks for the analytics agent.

Pure functions over numpy arrays. Every result is a plain JSON-safe dict (no NaN or infinity), so
it can be shown, stored and cited as evidence. Assumptions are checked and reported in `notes`,
never silently ignored. Tests in tests/test_agent_stats.py use hand-computed expected values.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from scipy import stats as sps

MIN_GROUP_SIZE = 2
MAX_HISTOGRAM_BINS = 30


def num(value: Any, digits: int = 6) -> float | None:
    """A finite float rounded to `digits` decimals, or None."""
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(out):
        return None
    return round(out, digits)


def _clean(values: Any) -> np.ndarray:
    arr = np.asarray(values, dtype="float64")
    return arr[np.isfinite(arr)]


# ------------------------------------------------------------------ univariate


def describe_numeric(values: Any) -> dict[str, Any]:
    """Count, centre, spread, shape, IQR outliers and a histogram for one numeric variable."""
    x = _clean(values)
    n = int(x.size)
    out: dict[str, Any] = {"n": n, "notes": []}
    if n == 0:
        out["notes"].append("No numeric values to describe.")
        return out
    q1, median, q3 = (float(v) for v in np.percentile(x, [25, 50, 75]))  # linear interpolation, as pandas
    iqr = q3 - q1
    lower, upper = q1 - 1.5 * iqr, q3 + 1.5 * iqr
    outliers = int(((x < lower) | (x > upper)).sum())
    out.update(
        {
            "sum": num(x.sum()),
            "mean": num(x.mean()),
            "median": num(median),
            "std": num(x.std(ddof=1)) if n > 1 else None,
            "variance": num(x.var(ddof=1)) if n > 1 else None,
            "min": num(x.min()),
            "max": num(x.max()),
            "q1": num(q1),
            "q3": num(q3),
            "iqr": num(iqr),
            "p05": num(np.percentile(x, 5)),
            "p95": num(np.percentile(x, 95)),
            # Adjusted Fisher-Pearson skewness and excess kurtosis (same definitions as pandas).
            "skewness": num(sps.skew(x, bias=False)) if n >= 3 and x.std() > 0 else None,
            "excess_kurtosis": num(sps.kurtosis(x, fisher=True, bias=False)) if n >= 4 and x.std() > 0 else None,
            "lower_fence": num(lower),
            "upper_fence": num(upper),
            "outlier_count": outliers,
            "outlier_share": num(outliers / n, 4),
            "zero_count": int((x == 0).sum()),
            "negative_count": int((x < 0).sum()),
            "histogram": histogram(x),
        }
    )
    skew = out["skewness"]
    if skew is not None and abs(skew) >= 1:
        out["notes"].append("Strongly skewed: the median describes a typical value better than the mean.")
    if outliers:
        out["notes"].append(f"{outliers} value(s) fall outside the 1.5×IQR fences; they are flagged, not removed.")
    return out


def histogram(x: np.ndarray) -> list[dict[str, Any]]:
    if x.size == 0:
        return []
    if float(x.min()) == float(x.max()):
        return [{"start": num(x.min()), "end": num(x.max()), "count": int(x.size)}]
    edges = np.histogram_bin_edges(x, bins="auto")
    if len(edges) - 1 > MAX_HISTOGRAM_BINS:
        edges = np.histogram_bin_edges(x, bins=MAX_HISTOGRAM_BINS)
    counts, edges = np.histogram(x, bins=edges)
    return [{"start": num(edges[i]), "end": num(edges[i + 1]), "count": int(c)} for i, c in enumerate(counts)]


def describe_categorical(labels: list[str], missing: int, top: int = 15) -> dict[str, Any]:
    """Frequencies, mode and imbalance for one categorical variable (labels exclude missing values)."""
    n = len(labels)
    out: dict[str, Any] = {"n": n, "missing": missing, "notes": []}
    if n == 0:
        out["notes"].append("No values to describe.")
        return out
    values, counts = np.unique(np.asarray(labels, dtype=object), return_counts=True)
    order = np.lexsort((values.astype(str), -counts))  # by count desc, then label
    values, counts = values[order], counts[order]
    shown = [{"value": str(v)[:80], "count": int(c), "share": num(c / n, 4)} for v, c in zip(values[:top], counts[:top], strict=True)]
    other = int(counts[top:].sum())
    out.update(
        {
            "unique": int(values.size),
            "mode": shown[0]["value"],
            "mode_share": shown[0]["share"],
            "frequencies": shown,
            "other_count": other,
            "rare_categories": int((counts < 5).sum()),
            # Largest category divided by smallest; 1 = perfectly balanced.
            "imbalance_ratio": num(counts[0] / counts[-1], 3),
        }
    )
    if out["mode_share"] is not None and out["mode_share"] >= 0.8 and values.size > 1:
        out["notes"].append("One category holds at least 80% of rows: comparisons across categories rest on few rows.")
    if values.size > top:
        out["notes"].append(f"Showing the top {top} of {values.size} categories; the rest are grouped as 'other'.")
    return out


# ------------------------------------------------------------------ bivariate


def correlation(x: Any, y: Any) -> dict[str, Any]:
    """Pearson and Spearman correlation on pairwise-complete observations."""
    xa, ya = np.asarray(x, dtype="float64"), np.asarray(y, dtype="float64")
    keep = np.isfinite(xa) & np.isfinite(ya)
    xa, ya = xa[keep], ya[keep]
    n = int(xa.size)
    out: dict[str, Any] = {"n": n, "notes": []}
    if n < 3 or xa.std() == 0 or ya.std() == 0:
        out["notes"].append("Not enough varying paired values to estimate a correlation.")
        return out
    pearson = sps.pearsonr(xa, ya)
    spearman = sps.spearmanr(xa, ya)
    out.update(
        {
            "pearson_r": num(pearson.statistic),
            "pearson_p": num(pearson.pvalue, 10),
            "spearman_rho": num(spearman.statistic),
            "spearman_p": num(spearman.pvalue, 10),
            "r_squared": num(pearson.statistic**2),
        }
    )
    if n < 30:
        out["notes"].append("Fewer than 30 pairs: treat the strength of the relationship as indicative only.")
    if abs((out["pearson_r"] or 0) - (out["spearman_rho"] or 0)) >= 0.2:
        out["notes"].append("Pearson and Spearman differ noticeably: the relationship may be non-linear or driven by outliers.")
    out["notes"].append("Correlation describes association only; it does not show that one variable causes the other.")
    return out


def compare_groups(groups: dict[str, Any]) -> dict[str, Any]:
    """Compare a numeric variable across groups.

    Two groups: Welch's t-test (unequal variances), mean difference with a 95% CI, Hedges' g, and
    Mann-Whitney U as a distribution-free check. Three or more: one-way ANOVA, Alexander-Govern
    (robust to unequal variances, a Welch-ANOVA alternative), Kruskal-Wallis, eta² and omega².
    """
    clean = {k: _clean(v) for k, v in groups.items()}
    used = {k: v for k, v in clean.items() if v.size >= MIN_GROUP_SIZE}
    summary = [
        {
            "group": k,
            "n": int(v.size),
            "mean": num(v.mean()) if v.size else None,
            "median": num(np.median(v)) if v.size else None,
            "std": num(v.std(ddof=1)) if v.size > 1 else None,
        }
        for k, v in clean.items()
    ]
    out: dict[str, Any] = {"groups": summary, "notes": []}
    skipped = [k for k in clean if k not in used]
    if skipped:
        out["notes"].append(f"{len(skipped)} group(s) with fewer than {MIN_GROUP_SIZE} values were left out of the test.")
    if len(used) < 2:
        out["test"] = None
        out["notes"].append("Fewer than two groups with enough values: no test was run.")
        return out
    arrays = list(used.values())
    if all(a.std() == 0 for a in arrays):
        out["test"] = None
        out["notes"].append("Every group has constant values: a significance test is not meaningful.")
        return out
    if len(arrays) == 2:
        a, b = arrays
        t = sps.ttest_ind(a, b, equal_var=False)
        diff = float(a.mean() - b.mean())
        se = math.sqrt(a.var(ddof=1) / a.size + b.var(ddof=1) / b.size)
        crit = float(sps.t.ppf(0.975, t.df))
        pooled = math.sqrt(((a.size - 1) * a.var(ddof=1) + (b.size - 1) * b.var(ddof=1)) / (a.size + b.size - 2))
        correction = 1 - 3 / (4 * (a.size + b.size) - 9)  # Hedges' small-sample correction
        mw = sps.mannwhitneyu(a, b, alternative="two-sided")
        out["test"] = {
            "name": "welch_t_test",
            "groups_compared": list(used)[:2],
            "statistic": num(t.statistic),
            "df": num(t.df),
            "p_value": num(t.pvalue, 10),
            "mean_difference": num(diff),
            "ci95_low": num(diff - crit * se),
            "ci95_high": num(diff + crit * se),
            "effect_size": {"name": "hedges_g", "value": num(diff / pooled * correction) if pooled > 0 else None},
            "robust_check": {"name": "mann_whitney_u", "statistic": num(mw.statistic), "p_value": num(mw.pvalue, 10)},
        }
    else:
        f = sps.f_oneway(*arrays)
        ag = sps.alexandergovern(*arrays)
        kw = sps.kruskal(*arrays)
        allv = np.concatenate(arrays)
        grand = allv.mean()
        ss_between = float(sum(a.size * (a.mean() - grand) ** 2 for a in arrays))
        ss_total = float(((allv - grand) ** 2).sum())
        k, n = len(arrays), allv.size
        ms_within = (ss_total - ss_between) / (n - k) if n > k else float("nan")
        omega = (ss_between - (k - 1) * ms_within) / (ss_total + ms_within) if ss_total > 0 else float("nan")
        out["test"] = {
            "name": "one_way_anova",
            "groups_compared": list(used),
            "statistic": num(f.statistic),
            "df_between": k - 1,
            "df_within": int(n - k),
            "p_value": num(f.pvalue, 10),
            "effect_size": {
                "name": "eta_squared",
                "value": num(ss_between / ss_total) if ss_total > 0 else None,
                "omega_squared": num(max(omega, 0.0)),
            },
            "unequal_variance_check": {"name": "alexander_govern", "statistic": num(ag.statistic), "p_value": num(ag.pvalue, 10)},
            "robust_check": {"name": "kruskal_wallis", "statistic": num(kw.statistic), "p_value": num(kw.pvalue, 10)},
        }
    if any(a.size < 30 for a in arrays):
        out["notes"].append("Some groups have fewer than 30 values: the distribution-free check is shown alongside the main test.")
    out["notes"].append("A significant difference shows association with the grouping, not that the grouping causes it.")
    return out


def chi_square(table: list[list[int]], row_labels: list[str], col_labels: list[str]) -> dict[str, Any]:
    """Chi-square test of independence (no continuity correction) with Cramér's V."""
    observed = np.asarray(table, dtype="float64")
    out: dict[str, Any] = {"rows": row_labels, "columns": col_labels, "counts": [[int(v) for v in r] for r in observed], "notes": []}
    observed = observed[observed.sum(axis=1) > 0][:, observed.sum(axis=0) > 0]
    n = float(observed.sum())
    if observed.shape[0] < 2 or observed.shape[1] < 2 or n == 0:
        out["test"] = None
        out["notes"].append("Need at least two categories with data on each side for a chi-square test.")
        return out
    res = sps.chi2_contingency(observed, correction=False)
    k = min(observed.shape) - 1
    low_expected = float((res.expected_freq < 5).mean())
    out["test"] = {
        "name": "chi_square_independence",
        "statistic": num(res.statistic),
        "df": int(res.dof),
        "p_value": num(res.pvalue, 10),
        "n": int(n),
        "effect_size": {"name": "cramers_v", "value": num(math.sqrt(res.statistic / (n * k))) if k > 0 else None},
        "share_expected_below_5": num(low_expected, 4),
    }
    row_totals = observed.sum(axis=1, keepdims=True)
    out["row_proportions"] = [
        [num(v, 4) for v in r] for r in np.divide(observed, row_totals, out=np.zeros_like(observed), where=row_totals > 0)
    ]
    if low_expected > 0.2:
        out["notes"].append("More than 20% of expected counts are below 5: the chi-square approximation is unreliable.")
    out["notes"].append("Association between categories does not establish cause.")
    return out


# ------------------------------------------------------------------ multivariate


def correlation_matrix(columns: dict[str, Any]) -> dict[str, Any]:
    names = list(columns)
    data = np.column_stack([np.asarray(columns[c], dtype="float64") for c in names]) if names else np.empty((0, 0))
    k = len(names)
    pearson = [[None] * k for _ in range(k)]
    spearman = [[None] * k for _ in range(k)]
    pairs = []
    for i in range(k):
        pearson[i][i] = spearman[i][i] = 1.0
        for j in range(i + 1, k):
            res = correlation(data[:, i], data[:, j])
            pearson[i][j] = pearson[j][i] = res.get("pearson_r")
            spearman[i][j] = spearman[j][i] = res.get("spearman_rho")
            if res.get("pearson_r") is not None:
                pairs.append(
                    {
                        "x": names[i],
                        "y": names[j],
                        "n": res["n"],
                        "pearson_r": res["pearson_r"],
                        "spearman_rho": res["spearman_rho"],
                        "pearson_p": res["pearson_p"],
                    }
                )
    pairs.sort(key=lambda p: -abs(p["spearman_rho"] or 0))
    return {
        "columns": names,
        "pearson": pearson,
        "spearman": spearman,
        "strongest_pairs": pairs[:10],
        "notes": ["Identifiers are excluded; pairs use pairwise-complete rows."],
    }


def pca(columns: dict[str, Any], min_rows: int = 10) -> dict[str, Any]:
    """PCA on standardised complete cases: explained variance and the strongest loadings."""
    names = list(columns)
    data = np.column_stack([np.asarray(columns[c], dtype="float64") for c in names])
    data = data[np.isfinite(data).all(axis=1)]
    out: dict[str, Any] = {"columns": names, "n": int(data.shape[0]), "notes": []}
    if len(names) < 3 or data.shape[0] < min_rows:
        out["notes"].append(f"PCA needs at least 3 numeric variables and {min_rows} complete rows.")
        return out
    std = data.std(axis=0, ddof=1)
    keep = std > 0
    data, names = data[:, keep], [n for n, k in zip(names, keep, strict=True) if k]
    z = (data - data.mean(axis=0)) / data.std(axis=0, ddof=1)
    _, s, vt = np.linalg.svd(z, full_matrices=False)
    var = s**2 / (z.shape[0] - 1)
    ratio = var / var.sum()
    out["columns"] = names
    out["explained_variance_ratio"] = [num(r, 4) for r in ratio]
    out["components"] = [
        {
            "component": f"PC{i + 1}",
            "loadings": sorted(
                ({"variable": n, "loading": num(w, 4)} for n, w in zip(names, vt[i], strict=True)), key=lambda d: -abs(d["loading"] or 0)
            ),
        }
        for i in range(min(2, len(names)))
    ]
    out["notes"].append("Components are combinations of standardised variables; they summarise shared variation, not causes.")
    return out


def regression(y: Any, predictors: dict[str, Any]) -> dict[str, Any]:
    """Ordinary least squares with an intercept, on complete cases."""
    names = list(predictors)
    data = np.column_stack([np.asarray(y, dtype="float64")] + [np.asarray(predictors[c], dtype="float64") for c in names])
    data = data[np.isfinite(data).all(axis=1)]
    n, k = data.shape[0], len(names)
    out: dict[str, Any] = {"n": int(n), "predictors": names, "notes": []}
    if n < max(20, 10 * k):
        out["notes"].append(f"Too few complete rows ({n}) for {k} predictor(s); at least {max(20, 10 * k)} are needed.")
        return out
    yv, x = data[:, 0], np.column_stack([np.ones(n), data[:, 1:]])
    beta, *_ = np.linalg.lstsq(x, yv, rcond=None)
    resid = yv - x @ beta
    dof = n - k - 1
    sigma2 = float(resid @ resid) / dof
    cov = sigma2 * np.linalg.pinv(x.T @ x)
    se = np.sqrt(np.clip(np.diag(cov), 0, None))
    tvals = np.divide(beta, se, out=np.zeros_like(beta), where=se > 0)
    pvals = 2 * sps.t.sf(np.abs(tvals), dof)
    ss_tot = float(((yv - yv.mean()) ** 2).sum())
    r2 = 1 - float(resid @ resid) / ss_tot if ss_tot > 0 else None
    out.update(
        {
            "r_squared": num(r2),
            "adj_r_squared": num(1 - (1 - r2) * (n - 1) / dof) if r2 is not None else None,
            "coefficients": [
                {"term": t, "estimate": num(b), "std_error": num(s), "p_value": num(p, 10)}
                for t, b, s, p in zip(["intercept", *names], beta, se, pvals, strict=True)
            ],
            "condition_number": num(np.linalg.cond(x[:, 1:] - x[:, 1:].mean(axis=0)) if k > 1 else 1.0, 2),
        }
    )
    if out["condition_number"] and out["condition_number"] > 30:
        out["notes"].append("Predictors are strongly inter-related (high condition number): individual coefficients are unstable.")
    out["notes"].append("Coefficients describe association holding the other predictors fixed; they are not causal effects.")
    return out


# ------------------------------------------------------------------ validation helpers


def holm_adjust(pvalues: list[float]) -> list[float]:
    """Holm-Bonferroni adjusted p-values (controls the family-wise error rate)."""
    m = len(pvalues)
    order = sorted(range(m), key=lambda i: pvalues[i])
    adjusted = [0.0] * m
    running = 0.0
    for rank, i in enumerate(order):
        running = max(running, min(1.0, (m - rank) * pvalues[i]))
        adjusted[i] = running
    return [round(p, 10) for p in adjusted]


def linear_trend(values: list[float]) -> dict[str, Any]:
    """Least-squares slope per period over an evenly spaced series."""
    y = _clean(values)
    if y.size < 3:
        return {"n_periods": int(y.size), "slope_per_period": None, "p_value": None}
    res = sps.linregress(np.arange(y.size, dtype="float64"), y)
    return {"n_periods": int(y.size), "slope_per_period": num(res.slope), "p_value": num(res.pvalue, 10), "r": num(res.rvalue)}


def concentration(values: list[float]) -> dict[str, Any]:
    """Share held by the largest segment and the Herfindahl-Hirschman index of segment shares."""
    v = np.asarray([x for x in values if x is not None and x > 0], dtype="float64")
    if v.size == 0 or v.sum() <= 0:
        return {"top_share": None, "hhi": None}
    shares = np.sort(v / v.sum())[::-1]
    return {
        "top_share": num(shares[0], 4),
        "top_3_share": num(shares[:3].sum(), 4),
        "hhi": num(float((shares**2).sum()), 4),
        "positive_segments": int(v.size),
    }
