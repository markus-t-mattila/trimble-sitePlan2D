import type { UserArea } from "../types";

/*
Project-wide registry of user-area names, case-insensitive. Used by the
annotator to reject duplicate names at draw time. The registry is rebuilt on
every storey-document load and updated whenever an area is added/renamed.
*/

export class AreaNameRegistry {
  private readonly lowerCaseNames = new Set<string>();

  reset(areas: ReadonlyArray<UserArea>): void {
    this.lowerCaseNames.clear();
    for (const area of areas) this.lowerCaseNames.add(area.name.trim().toLowerCase());
  }

  contains(name: string): boolean {
    return this.lowerCaseNames.has(name.trim().toLowerCase());
  }

  add(name: string): boolean {
    const lower = name.trim().toLowerCase();
    if (this.lowerCaseNames.has(lower)) return false;
    this.lowerCaseNames.add(lower);
    return true;
  }

  rename(oldName: string, newName: string): boolean {
    const oldLower = oldName.trim().toLowerCase();
    const newLower = newName.trim().toLowerCase();
    if (oldLower === newLower) return true;
    if (this.lowerCaseNames.has(newLower)) return false;
    this.lowerCaseNames.delete(oldLower);
    this.lowerCaseNames.add(newLower);
    return true;
  }

  remove(name: string): void {
    this.lowerCaseNames.delete(name.trim().toLowerCase());
  }
}
