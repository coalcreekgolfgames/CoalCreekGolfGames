export const teeOptions = [
  "Black",
  "Silver",
  "Silver/Blue",
  "Blue",
  "Green"
] as const;

export type TeeOption = (typeof teeOptions)[number];

export type RatingType = "men" | "women";

export const DEFAULT_TEE_OPTION: TeeOption = "Silver";

export function isTeeOption(value: unknown): value is TeeOption {
  return typeof value === "string" && teeOptions.includes(value as TeeOption);
}

export function resolveTeeOption(value: unknown): TeeOption {
  return isTeeOption(value) ? value : DEFAULT_TEE_OPTION;
}

export function teeDisplayLabel(value: unknown) {
  const tee = resolveTeeOption(value);
  return isTeeOption(value) ? `${tee} Tees` : `${tee} Tees (default)`;
}

export function yardageForHoleAndTee(hole: { yards: Partial<Record<TeeOption, number>> }, tee: unknown) {
  return hole.yards[resolveTeeOption(tee)] ?? hole.yards[DEFAULT_TEE_OPTION] ?? 0;
}

export const ratings = {
  "Black": {
    "men": {
      "slope": 143,
      "rating": 75.0
    }
  },
  "Silver": {
    "men": {
      "slope": 138,
      "rating": 71.8
    }
  },
  "Silver/Blue": {
    "men": {
      "slope": 135,
      "rating": 70.4
    }
  },
  "Blue": {
    "men": {
      "slope": 128,
      "rating": 69.4
    },
    "women": {
      "slope": 142,
      "rating": 75.4
    }
  },
  "Green": {
    "women": {
      "slope": 134,
      "rating": 72.1
    }
  }
} as const;

export const holes = [
  {
    "hole": 1,
    "par": 4,
    "hcp": 9,
    "yards": {
      "Black": 417,
      "Silver": 387,
      "Silver/Blue": 387,
      "Blue": 359,
      "Green": 334
    },
    "widthsSilver": {
      "240": 39,
      "260": 37,
      "290": 35
    },
    "images": {
      "green": "assets/hole-01-green.jpg",
      "fairway": "assets/hole-01-fairway.jpg"
    }
  },
  {
    "hole": 2,
    "par": 4,
    "hcp": 11,
    "yards": {
      "Black": 403,
      "Silver": 365,
      "Silver/Blue": 365,
      "Blue": 334,
      "Green": 311
    },
    "widthsSilver": {
      "240": 29,
      "260": 30,
      "290": 38
    },
    "images": {
      "green": "assets/hole-02-green.jpg",
      "fairway": "assets/hole-02-fairway.jpg"
    }
  },
  {
    "hole": 3,
    "par": 5,
    "hcp": 5,
    "yards": {
      "Black": 567,
      "Silver": 530,
      "Silver/Blue": 494,
      "Blue": 494,
      "Green": 472
    },
    "widthsSilver": {
      "240": 32,
      "260": 45,
      "290": 40
    },
    "images": {
      "green": "assets/hole-03-green.jpg",
      "fairway": "assets/hole-03-fairway.jpg"
    }
  },
  {
    "hole": 4,
    "par": 3,
    "hcp": 15,
    "yards": {
      "Black": 180,
      "Silver": 149,
      "Silver/Blue": 149,
      "Blue": 123,
      "Green": 100
    },
    "widthsSilver": null,
    "images": {
      "green": "assets/hole-04-green.jpg",
      "fairway": "assets/hole-04-fairway.jpg"
    }
  },
  {
    "hole": 5,
    "par": 4,
    "hcp": 7,
    "yards": {
      "Black": 454,
      "Silver": 405,
      "Silver/Blue": 363,
      "Blue": 363,
      "Green": 345
    },
    "widthsSilver": {
      "240": 37,
      "260": 32,
      "290": 25
    },
    "images": {
      "green": "assets/hole-05-green.jpg",
      "fairway": "assets/hole-05-fairway.jpg"
    }
  },
  {
    "hole": 6,
    "par": 5,
    "hcp": 3,
    "yards": {
      "Black": 603,
      "Silver": 561,
      "Silver/Blue": 516,
      "Blue": 516,
      "Green": 456
    },
    "widthsSilver": {
      "240": 32,
      "260": 33,
      "290": 0
    },
    "images": {
      "green": "assets/hole-06-green.jpg",
      "fairway": "assets/hole-06-fairway.jpg"
    }
  },
  {
    "hole": 7,
    "par": 4,
    "hcp": 17,
    "yards": {
      "Black": 373,
      "Silver": 332,
      "Silver/Blue": 332,
      "Blue": 295,
      "Green": 242
    },
    "widthsSilver": {
      "240": 83,
      "260": 76,
      "290": 14
    },
    "images": {
      "green": "assets/hole-07-green.jpg",
      "fairway": "assets/hole-07-fairway.jpg"
    }
  },
  {
    "hole": 8,
    "par": 3,
    "hcp": 13,
    "yards": {
      "Black": 189,
      "Silver": 164,
      "Silver/Blue": 144,
      "Blue": 144,
      "Green": 119
    },
    "widthsSilver": null,
    "images": {
      "green": "assets/hole-08-green.jpg",
      "fairway": "assets/hole-08-fairway.jpg"
    }
  },
  {
    "hole": 9,
    "par": 4,
    "hcp": 1,
    "yards": {
      "Black": 459,
      "Silver": 415,
      "Silver/Blue": 383,
      "Blue": 383,
      "Green": 366
    },
    "widthsSilver": {
      "240": 26,
      "260": 24,
      "290": 21
    },
    "images": {
      "green": "assets/hole-09-green.jpg",
      "fairway": "assets/hole-09-fairway.jpg"
    }
  },
  {
    "hole": 10,
    "par": 5,
    "hcp": 6,
    "yards": {
      "Black": 556,
      "Silver": 528,
      "Silver/Blue": 528,
      "Blue": 497,
      "Green": 456
    },
    "widthsSilver": {
      "240": 31,
      "260": 28,
      "290": 27
    },
    "images": {
      "green": "assets/hole-10-green.jpg",
      "fairway": "assets/hole-10-fairway.jpg"
    }
  },
  {
    "hole": 11,
    "par": 4,
    "hcp": 2,
    "yards": {
      "Black": 439,
      "Silver": 403,
      "Silver/Blue": 379,
      "Blue": 379,
      "Green": 356
    },
    "widthsSilver": {
      "240": 25,
      "260": 34,
      "290": 33
    },
    "images": {
      "green": "assets/hole-11-green.jpg",
      "fairway": "assets/hole-11-fairway.jpg"
    }
  },
  {
    "hole": 12,
    "par": 4,
    "hcp": 10,
    "yards": {
      "Black": 411,
      "Silver": 359,
      "Silver/Blue": 359,
      "Blue": 311,
      "Green": 265
    },
    "widthsSilver": {
      "240": 33,
      "260": 30,
      "290": 20
    },
    "images": {
      "green": "assets/hole-12-green.jpg",
      "fairway": "assets/hole-12-fairway.jpg"
    }
  },
  {
    "hole": 13,
    "par": 3,
    "hcp": 16,
    "yards": {
      "Black": 208,
      "Silver": 189,
      "Silver/Blue": 169,
      "Blue": 169,
      "Green": 95
    },
    "widthsSilver": null,
    "images": {
      "green": "assets/hole-13-green.jpg",
      "fairway": "assets/hole-13-fairway.jpg"
    }
  },
  {
    "hole": 14,
    "par": 4,
    "hcp": 14,
    "yards": {
      "Black": 356,
      "Silver": 313,
      "Silver/Blue": 313,
      "Blue": 294,
      "Green": 279
    },
    "widthsSilver": {
      "240": 74,
      "260": 80,
      "290": 0
    },
    "images": {
      "green": "assets/hole-14-green.jpg",
      "fairway": "assets/hole-14-fairway.jpg"
    }
  },
  {
    "hole": 15,
    "par": 5,
    "hcp": 4,
    "yards": {
      "Black": 573,
      "Silver": 531,
      "Silver/Blue": 496,
      "Blue": 496,
      "Green": 446
    },
    "widthsSilver": {
      "240": 41,
      "260": 27,
      "290": 35
    },
    "images": {
      "green": "assets/hole-15-green.jpg",
      "fairway": "assets/hole-15-fairway.jpg"
    }
  },
  {
    "hole": 16,
    "par": 4,
    "hcp": 12,
    "yards": {
      "Black": 413,
      "Silver": 370,
      "Silver/Blue": 370,
      "Blue": 342,
      "Green": 314
    },
    "widthsSilver": {
      "240": 36,
      "260": 34,
      "290": 25
    },
    "images": {
      "green": "assets/hole-16-green.jpg",
      "fairway": "assets/hole-16-fairway.jpg"
    }
  },
  {
    "hole": 17,
    "par": 3,
    "hcp": 18,
    "yards": {
      "Black": 192,
      "Silver": 158,
      "Silver/Blue": 158,
      "Blue": 142,
      "Green": 115
    },
    "widthsSilver": null,
    "images": {
      "green": "assets/hole-17-green.jpg",
      "fairway": "assets/hole-17-fairway.jpg"
    }
  },
  {
    "hole": 18,
    "par": 4,
    "hcp": 8,
    "yards": {
      "Black": 414,
      "Silver": 378,
      "Silver/Blue": 345,
      "Blue": 345,
      "Green": 313
    },
    "widthsSilver": {
      "240": 46,
      "260": 50,
      "290": 40
    },
    "images": {
      "green": "assets/hole-18-green.jpg",
      "fairway": "assets/hole-18-fairway.jpg"
    }
  }
] as const;


export function totalYardageForTee(tee: TeeOption) {
  return holes.reduce((sum, hole) => sum + (hole.yards[tee] ?? 0), 0);
}

export function frontNineYardageForTee(tee: TeeOption) {
  return holes.slice(0, 9).reduce((sum, hole) => sum + (hole.yards[tee] ?? 0), 0);
}

export function backNineYardageForTee(tee: TeeOption) {
  return holes.slice(9).reduce((sum, hole) => sum + (hole.yards[tee] ?? 0), 0);
}

export function ratingInfoFor(tee: TeeOption, ratingType: RatingType) {
  const ratingRow = ratings[tee as keyof typeof ratings];
  return ratingRow?.[ratingType as keyof typeof ratingRow] ?? null;
}
