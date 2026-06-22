import type Konva from 'konva';

let _stage: Konva.Stage | null = null;

export function setStageRef(stage: Konva.Stage | null) { _stage = stage; }
export function getStageRef(): Konva.Stage | null       { return _stage; }
