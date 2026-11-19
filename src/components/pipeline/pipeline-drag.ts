import {
  closestCenter,
  pointerWithin,
  type CollisionDetection,
  type KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import { LEAD_STATUSES } from "@/lib/leads/statuses";

export const pipelineCollision: CollisionDetection = (args) =>
  args.pointerCoordinates ? pointerWithin(args) : closestCenter(args);

export const pipelineKeyboardCoordinates: KeyboardCoordinateGetter = (
  event,
  { context, currentCoordinates },
) => {
  if (event.code !== "ArrowLeft" && event.code !== "ArrowRight") return;
  const current = context.over?.id ?? context.active?.data.current?.status;
  const index = LEAD_STATUSES.findIndex((status) => status.value === current);
  if (index < 0 || !context.collisionRect) return;
  const target = LEAD_STATUSES[index + (event.code === "ArrowRight" ? 1 : -1)];
  if (!target) return;
  const rect = context.droppableRects.get(target.value);
  if (!rect || context.droppableContainers.get(target.value)?.disabled) return;
  return {
    x:
      currentCoordinates.x +
      rect.left +
      rect.width / 2 -
      context.collisionRect.left -
      context.collisionRect.width / 2,
    y:
      currentCoordinates.y +
      rect.top +
      rect.height / 2 -
      context.collisionRect.top -
      context.collisionRect.height / 2,
  };
};
