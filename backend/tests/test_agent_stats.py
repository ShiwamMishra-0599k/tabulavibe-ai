"""Statistics for the analytics agent, checked against hand-computed values."""

import math

import pytest

from app.agent import stats

UNITS = [10, 5, 3, 7, 7, 2, 4, 1, 6]  # the fixture's 'units' column (conftest), missing value removed


def approx(value, expected, tol=1e-3):
    return value is not None and abs(value - expected) <= tol


def test_describe_numeric_matches_hand_calculation():
    d = stats.describe_numeric(UNITS)
    # sorted: 1 2 3 4 5 6 7 7 10 -> n=9, sum=45, mean=5, median=5
    assert (d["n"], d["sum"], d["mean"], d["median"], d["min"], d["max"]) == (9, 45, 5, 5, 1, 10)
    # deviations 5,0,-2,2,2,-3,-1,-4,1 -> squares sum 64 -> variance 64/8 = 8
    assert d["variance"] == 8
    assert approx(d["std"], math.sqrt(8))
    # linear-interpolation quartiles: position 2 -> 3, position 6 -> 7; IQR 4; fences -3 and 13
    assert (d["q1"], d["q3"], d["iqr"], d["lower_fence"], d["upper_fence"]) == (3, 7, 4, -3, 13)
    assert d["outlier_count"] == 0
    # m2=64/9, m3=42/9 -> g1=0.24609 -> adjusted G1 = g1*sqrt(72)/7 = 0.29830
    assert approx(d["skewness"], 0.2983)
    # m4=1012/9 -> g2=-0.77638 -> G2 = ((n+1)g2+6)(n-1)/((n-2)(n-3)) = -0.33596
    assert approx(d["excess_kurtosis"], -0.3360)
    assert sum(b["count"] for b in d["histogram"]) == 9


def test_outliers_are_flagged_not_removed():
    d = stats.describe_numeric([1, 2, 3, 4, 100])
    # q1=2, q3=4, IQR=2 -> upper fence 7 -> 100 is an outlier
    assert (d["outlier_count"], d["upper_fence"], d["max"]) == (1, 7, 100)
    assert any("flagged, not removed" in n for n in d["notes"])


def test_describe_categorical():
    d = stats.describe_categorical(["North"] * 4 + ["South"] * 3 + ["East"] * 2 + ["West"], missing=0)
    assert (d["n"], d["unique"], d["mode"], d["mode_share"]) == (10, 4, "North", 0.4)
    assert [f["value"] for f in d["frequencies"]] == ["North", "South", "East", "West"]
    assert d["imbalance_ratio"] == 4  # 4 / 1
    assert d["rare_categories"] == 4  # every count is below 5


def test_welch_t_test_hand_example():
    res = stats.compare_groups({"A": [1, 2, 3], "B": [4, 5, 6]})
    t = res["test"]
    # means 2 and 5, both variances 1 -> se = sqrt(1/3 + 1/3) = 0.8165 -> t = -3.6742, Welch df = 4
    assert t["name"] == "welch_t_test"
    assert approx(t["statistic"], -3.6742) and approx(t["df"], 4)
    assert approx(t["p_value"], 0.02131, 1e-4)
    assert t["mean_difference"] == -3
    # 95% CI: -3 ± t(0.975, 4)=2.7764 × 0.8165 -> [-5.267, -0.733]
    assert approx(t["ci95_low"], -5.267) and approx(t["ci95_high"], -0.733)
    # Cohen's d = -3 / 1 = -3; Hedges correction 1 - 3/(4*6-9) = 0.8 -> g = -2.4
    assert t["effect_size"]["value"] == -2.4


def test_anova_hand_example():
    res = stats.compare_groups({"A": [1, 2, 3], "B": [4, 5, 6], "C": [7, 8, 9]})
    t = res["test"]
    # SSB = 3*(9+0+9) = 54, SSW = 6 -> F = (54/2)/(6/6) = 27, eta² = 54/60 = 0.9
    assert t["name"] == "one_way_anova"
    assert approx(t["statistic"], 27) and t["effect_size"]["value"] == 0.9
    assert (t["df_between"], t["df_within"]) == (2, 6)
    assert t["p_value"] < 0.002


def test_groups_too_small_are_reported():
    res = stats.compare_groups({"A": [1, 2, 3], "B": [4]})
    assert res["test"] is None
    assert any("fewer than 2 values" in n for n in res["notes"])


def test_correlation_hand_examples():
    linear = stats.correlation([1, 2, 3, 4, 5], [2, 4, 6, 8, 10])
    assert linear["pearson_r"] == 1 and linear["spearman_rho"] == 1
    curved = stats.correlation([1, 2, 3, 4, 5], [1, 4, 9, 16, 25])
    assert curved["spearman_rho"] == 1  # perfectly monotonic
    assert approx(curved["pearson_r"], 0.9811)  # but not perfectly linear
    assert any("does not show that one variable causes" in n for n in curved["notes"])


def test_correlation_needs_variation():
    assert "pearson_r" not in stats.correlation([1, 1, 1, 1], [1, 2, 3, 4])


def test_chi_square_hand_example():
    res = stats.chi_square([[10, 20], [20, 10]], ["a", "b"], ["x", "y"])
    t = res["test"]
    # expected 15 everywhere -> chi² = 4 × 25/15 = 6.6667; V = sqrt(6.6667/60) = 0.3333
    assert approx(t["statistic"], 6.6667) and approx(t["effect_size"]["value"], 0.3333)
    assert t["df"] == 1 and approx(t["p_value"], 0.00982, 1e-4)
    assert res["row_proportions"] == [[0.3333, 0.6667], [0.6667, 0.3333]]


def test_holm_adjustment_hand_example():
    # sorted 0.01×3 = 0.03, 0.03×2 = 0.06, 0.04×1 = 0.04 -> monotone max 0.06
    assert stats.holm_adjust([0.01, 0.04, 0.03]) == [0.03, 0.06, 0.06]


def test_linear_trend_and_concentration():
    assert stats.linear_trend([10, 20, 30, 40])["slope_per_period"] == 10
    c = stats.concentration([60, 30, 10])
    # shares 0.6, 0.3, 0.1 -> HHI = 0.36 + 0.09 + 0.01 = 0.46
    assert (c["top_share"], c["top_3_share"], c["hhi"]) == (0.6, 1.0, 0.46)


def test_regression_recovers_exact_relationship():
    x1 = [float(i) for i in range(30)]
    x2 = [float((i * 7) % 11) for i in range(30)]
    y = [3 + 2 * a - 0.5 * b for a, b in zip(x1, x2, strict=True)]
    res = stats.regression(y, {"x1": x1, "x2": x2})
    est = {c["term"]: c["estimate"] for c in res["coefficients"]}
    assert approx(est["intercept"], 3) and approx(est["x1"], 2) and approx(est["x2"], -0.5)
    assert approx(res["r_squared"], 1)


def test_regression_refuses_small_samples():
    res = stats.regression([1, 2, 3], {"x": [1, 2, 3]})
    assert "coefficients" not in res and res["notes"]


def test_pca_explained_variance():
    a = [float(i) for i in range(20)]
    res = stats.pca({"a": a, "b": [2 * v for v in a], "c": [float((i * 3) % 7) for i in range(20)]})
    ratios = res["explained_variance_ratio"]
    assert approx(sum(ratios), 1)
    assert ratios[0] > 0.6  # a and b move together


@pytest.mark.parametrize("value", [float("nan"), float("inf"), "x", None])
def test_num_rejects_non_finite(value):
    assert stats.num(value) is None
