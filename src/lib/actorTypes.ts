import { ActorId } from "./types.ts";

// Use declaration merging to augment object literals in actor files
declare global {
  // This interface will automatically be applied to all object literals
  // that have a 'name' property and are passed to PostMan constructor
  interface Object {
    // These properties won't show up in the actual object until runtime
    // but TypeScript will know they exist for type checking
    id?: ActorId;
    addressBook?: Set<ActorId>;
  }
}

// Empty export to make this a module
export {};
