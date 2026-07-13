// Minimal Gaussian-process regression for Bayesian optimization.
// Inputs live in [0,1]^d; with ≤~30 noisy human trials, fixed sensible
// hyperparameters (ARD lengthscales passed in, signal variance from the data,
// explicit observation noise) are more robust than maximum-likelihood fitting.

export interface Posterior {
  mu: number;
  sigma: number;
}

export interface Gp {
  readonly best: number;
  predict(x: number[]): Posterior;
}

function cholesky(a: number[][]): number[][] {
  const n = a.length;
  const l = a.map(() => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = a[i][j];
      for (let m = 0; m < j; m++) s -= l[i][m] * l[j][m];
      if (i === j) l[i][j] = Math.sqrt(Math.max(s, 1e-10));
      else l[i][j] = s / l[j][j];
    }
  }
  return l;
}

function forwardSolve(l: number[][], b: number[]): number[] {
  const n = b.length;
  const y = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let m = 0; m < i; m++) s -= l[i][m] * y[m];
    y[i] = s / l[i][i];
  }
  return y;
}

function backSolve(l: number[][], y: number[]): number[] {
  const n = y.length;
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let m = i + 1; m < n; m++) s -= l[m][i] * x[m];
    x[i] = s / l[i][i];
  }
  return x;
}

/** Fit a GP with an RBF-ARD kernel. `ls` = per-dimension lengthscales, `sn2` = noise variance. */
export function fitGp(xs: number[][], ys: number[], ls: number[], sn2 = 0.02): Gp {
  const n = xs.length;
  const mean = ys.reduce((a, b) => a + b, 0) / n;
  const yc = ys.map((v) => v - mean);
  const varY = yc.reduce((a, b) => a + b * b, 0) / Math.max(1, n - 1);
  const sf2 = Math.max(0.02, varY);

  const kern = (a: number[], b: number[]): number => {
    let s = 0;
    for (let i = 0; i < a.length; i++) {
      const d = (a[i] - b[i]) / ls[i];
      s += d * d;
    }
    return sf2 * Math.exp(-0.5 * s);
  };

  const K = xs.map((xi, i) => xs.map((xj, j) => kern(xi, xj) + (i === j ? sn2 : 0)));
  const L = cholesky(K);
  const alpha = backSolve(L, forwardSolve(L, yc));

  return {
    best: Math.max(...ys),
    predict(x: number[]): Posterior {
      const kv = xs.map((xi) => kern(x, xi));
      const mu = mean + kv.reduce((a, b, i) => a + b * alpha[i], 0);
      const v = forwardSolve(L, kv);
      const s2 = Math.max(1e-9, sf2 - v.reduce((a, b) => a + b * b, 0));
      return { mu, sigma: Math.sqrt(s2) };
    },
  };
}

// Abramowitz & Stegun 7.1.26
function erf(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z));
  const p =
    t *
    (0.254829592 +
      t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const v = 1 - p * Math.exp(-z * z);
  return z >= 0 ? v : -v;
}

export function normCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

export function normPdf(z: number): number {
  return Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
}

export function expectedImprovement(p: Posterior, best: number, xi = 0.01): number {
  const d = p.mu - best - xi;
  if (p.sigma < 1e-9) return Math.max(0, d);
  const z = d / p.sigma;
  return d * normCdf(z) + p.sigma * normPdf(z);
}
