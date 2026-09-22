export type ClubMemberId = "joe" | "lou" | "chris" | "craig" | "ed";

export interface ClubMember {
  id: ClubMemberId;
  name: string;
  carName: string;
  shortCarName: string;
  year: number;
  color: string;
  accent: string;
  asset: string;
  manifest: string;
  preview: string;
  avatar: "dad" | "stand-in";
  note: string;
}

export const CLUB_MEMBERS: readonly ClubMember[] = [
  {
    id: "joe",
    name: "Joe",
    carName: "Oldsmobile 442",
    shortCarName: "442",
    year: 1968,
    color: "Midnight Sapphire",
    accent: "#78a9cf",
    avatar: "dad",
    note: "The blue convertible that started it all.",
    asset: "/assets/oldsmobile-442.glb",
    manifest: "/assets/vehicle-manifest.json",
    preview: "/assets/club-cars/joe-preview.png",
  },
  {
    id: "lou",
    name: "Lou",
    carName: "Pontiac Trans Am",
    shortCarName: "Trans Am",
    year: 1976,
    color: "Carousel Red",
    accent: "#f37b51",
    avatar: "stand-in",
    note: "Shaker scoop. Hood bird. Lou’s red Trans Am.",
    asset: "/assets/club-cars/lou.glb",
    manifest: "/assets/club-cars/lou-manifest.json",
    preview: "/assets/club-cars/lou-preview.png",
  },
  {
    id: "chris",
    name: "Chris",
    carName: "Chevrolet Camaro RS/SS",
    shortCarName: "Camaro",
    year: 1968,
    color: "Graphite · temporary color",
    accent: "#b9c2cb",
    avatar: "stand-in",
    note: "Inspired by Chris’s concours-restored RS/SS.",
    asset: "/assets/club-cars/chris.glb",
    manifest: "/assets/club-cars/chris-manifest.json",
    preview: "/assets/club-cars/chris-preview.png",
  },
  {
    id: "craig",
    name: "Craig",
    carName: "Pontiac 2+2 Convertible",
    shortCarName: "2+2",
    year: 1965,
    color: "Samoan Bronze",
    accent: "#d69771",
    avatar: "stand-in",
    note: "Long, low, bronze—and always better with the top down.",
    asset: "/assets/club-cars/craig.glb",
    manifest: "/assets/club-cars/craig-manifest.json",
    preview: "/assets/club-cars/craig-preview.png",
  },
  {
    id: "ed",
    name: "Ed",
    carName: "Buick Woody Wagon",
    shortCarName: "Buick",
    year: 1953,
    color: "Blue with wood trim",
    accent: "#81b6c9",
    avatar: "stand-in",
    note: "Blue paint, warm wood, and room for the whole club.",
    asset: "/assets/club-cars/ed.glb",
    manifest: "/assets/club-cars/ed-manifest.json",
    preview: "/assets/club-cars/ed-preview.png",
  },
];

export function clubMember(id: unknown): ClubMember {
  return CLUB_MEMBERS.find((member) => member.id === id) ?? CLUB_MEMBERS[0];
}

export const CLUB_SELECTION_KEY = "blue-county-lug-nuts-member-v1";

export function readClubMember(
  storage: Pick<Storage, "getItem"> | null,
): ClubMember {
  try {
    return clubMember(storage?.getItem(CLUB_SELECTION_KEY));
  } catch {
    return CLUB_MEMBERS[0];
  }
}

export function saveClubMember(
  storage: Pick<Storage, "setItem"> | null,
  id: ClubMemberId,
): void {
  try {
    storage?.setItem(CLUB_SELECTION_KEY, id);
  } catch {
    /* Selection still works when browser storage is unavailable. */
  }
}
