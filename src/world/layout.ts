export type GuestId = 'colonel' | 'reverend' | 'granny' | 'prudence' | 'dandy' | 'hostess';
export type FoodKind = 'pie' | 'sandwich' | 'scone' | 'sausage' | 'petitfour';
export type DrinkKind = 'wine' | 'tea' | 'champagne';

export interface SeatDef {
  id: GuestId;
  x: number;
  z: number;
  /** Facing yaw (radians, 0 = +z). */
  yaw: number;
  side: 'L' | 'R' | 'H';
  drink: DrinkKind;
  food: FoodKind;
  exit: [number, number][];
}

const TOWARD_CAM = 0.42; // seated guests are angled toward the camera end (stagecraft cheat)
const L_YAW = Math.PI / 2 - TOWARD_CAM;
const R_YAW = -Math.PI / 2 + TOWARD_CAM;

export const SEATS: SeatDef[] = [
  { id: 'colonel', x: -0.98, z: -1.15, yaw: L_YAW, side: 'L', drink: 'wine', food: 'pie', exit: [[-1.75, -0.9], [-1.9, -4.0], [-1.0, -7.4], [-0.5, -11]] },
  { id: 'dandy', x: -0.98, z: -0.05, yaw: L_YAW, side: 'L', drink: 'wine', food: 'sausage', exit: [[-1.75, 0.25], [-2.2, -3.4], [-1.1, -7.4], [-0.6, -11]] },
  { id: 'granny', x: -0.98, z: 1.05, yaw: L_YAW, side: 'L', drink: 'tea', food: 'scone', exit: [[-1.75, 1.4], [-2.5, -2.4], [-1.2, -7.4], [-0.7, -11]] },
  { id: 'prudence', x: 0.98, z: -0.6, yaw: R_YAW, side: 'R', drink: 'tea', food: 'sandwich', exit: [[1.75, -0.35], [1.9, -4.0], [1.0, -7.4], [0.5, -11]] },
  { id: 'reverend', x: 0.98, z: 0.55, yaw: R_YAW, side: 'R', drink: 'wine', food: 'scone', exit: [[1.75, 0.9], [2.3, -3.2], [1.1, -7.4], [0.6, -11]] },
  { id: 'hostess', x: 0, z: -2.25, yaw: 0, side: 'H', drink: 'champagne', food: 'petitfour', exit: [[0.85, -2.8], [0.5, -5.0], [0.1, -7.4], [0, -11]] },
];

/** Seat-local offset → world xz. Local: +z forward, -x is the diner's right hand. */
export function seatToWorld(seat: { x: number; z: number; yaw: number }, fwd: number, right: number): [number, number] {
  const fx = Math.sin(seat.yaw), fz = Math.cos(seat.yaw);
  // right = cross(f, up) = (-fz, 0, fx)
  const rx = -fz, rz = fx;
  return [seat.x + fx * fwd + rx * right, seat.z + fz * fwd + rz * right];
}
