/* ---------------------------------------------------------------------
   CONFIG + PRESETS — original work. Every behaviour knob lives here.
--------------------------------------------------------------------- */

export const defaultConfig = {
  RESOLUTION: 512,            // single sim+dye resolution (keeps the math simple/stable)
  CURL: 30,                   // how aggressively the fluid swirls
  PRESSURE_ITERATIONS: 27,    // Jacobi solver passes per frame (higher = more accurate)
  PRESSURE_DECAY: 0.8,        // pressure carried between frames
  VELOCITY_DISSIPATION: 0.98, // how long motion lingers (→1 = longer)
  DYE_DISSIPATION: 0.966,     // how long the ink lingers before fading
  SPLAT_RADIUS: 0.0009,       // width of the ink blob under the cursor
  SPLAT_FORCE: 6000,          // how hard cursor motion pushes the fluid
  inkColor: [1.0, 1.0, 1.0],  // white → "difference" blend inverts the page beneath
  threshold: 0.1,             // dye intensity needed before ink shows
  softness: 0.015             // edge falloff of the ink
};

export const PRESETS = {
  ink:   { CURL: 30, DYE_DISSIPATION: 0.966, SPLAT_RADIUS: 0.0009,  inkColor: [1.0, 1.0, 1.0],   threshold: 0.10, softness: 0.015, blend: "difference" },
  smoke: { CURL: 10, DYE_DISSIPATION: 0.985, SPLAT_RADIUS: 0.00055, inkColor: [1.0, 1.0, 1.0],   threshold: 0.05, softness: 0.10,  blend: "difference" },
  neon:  { CURL: 30, DYE_DISSIPATION: 0.965, SPLAT_RADIUS: 0.00022, inkColor: [0.10, 1.00, 0.55], threshold: 0.07, softness: 0.04,  blend: "difference" },
  mono:  { CURL: 24, DYE_DISSIPATION: 0.97,  SPLAT_RADIUS: 0.00022, inkColor: [0.0, 0.0, 0.0],   threshold: 0.12, softness: 0.0,   blend: "normal" }
};
