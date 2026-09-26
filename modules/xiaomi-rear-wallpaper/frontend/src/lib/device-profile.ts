/**
 * Confirmed panel output settings plus the measured mockup overlay geometry.
 * The output file stays rectangular; the reference image masks cameras/rounding.
 */
export const deviceProfile = {
  output: { width: 976, height: 596, densityPpi: 400 },
  reference: {
    width: 1211,
    height: 2512,
    display: { left: 128, top: 118, width: 955, height: 587 },
  },
} as const;
