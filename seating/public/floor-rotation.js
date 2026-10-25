// Presentation only: persisted table coordinates and seating distances stay unchanged.
export const FLOOR_ROTATION='rotate(180 830 475)';
export function rotateFloorPoint({x,y}){return {x:1660-x,y:950-y};}
export function rotateFloorBox([x,y,width,height]){return [1660-x-width,950-y-height,width,height];}
