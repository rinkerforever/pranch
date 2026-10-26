// Presentation only: stored table positions and seating distances stay unchanged.
export function floorAngle(state,view='All'){return state.viewOrientations?.[view]===0?0:180;}
export function floorTransform(angle=180){return `rotate(${angle} 830 475)`;}
export function rotateFloorPoint({x,y},angle=180){return angle===180?{x:1660-x,y:950-y}:{x,y};}
export function rotateFloorBox([x,y,width,height],angle=180){return angle===180?[1660-x-width,950-y-height,width,height]:[x,y,width,height];}
