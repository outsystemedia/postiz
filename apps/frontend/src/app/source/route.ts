// DesignerPRO addition — not upstream Postiz code.
//
// AGPL-3.0 §13 requires that users interacting with a modified version of
// this software over a network be offered access to the corresponding
// source. This route is that offer: a stable, discoverable link from the
// running service to this repository. See DESIGNERPRO_CHANGES.md at the
// repo root for exactly what was changed and when.
import { NextResponse } from 'next/server';

const SOURCE_REPOSITORY_URL = 'https://github.com/outsystemedia/postiz';

export async function GET() {
  return NextResponse.redirect(SOURCE_REPOSITORY_URL, { status: 302 });
}
