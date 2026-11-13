/** Last pin opened or chosen for the forecast. Not persisted. */
let standId: string | null = null;

export function rememberStand(id: string | null): void {
  standId = id;
}

export function rememberedStand(): string | null {
  return standId;
}
