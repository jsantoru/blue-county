import type * as T from "three";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import {
  CHARACTER_SEAT_ANCHOR,
  CharacterVisual,
  type CharacterVisualOptions,
} from "./character-visual";
import { DadCharacterVisual, type DadAnimation } from "./dad-character";
import type { SteeringWheelSpec } from "./steering-wheel";
import type { ClubMemberId } from "./club-roster";

export interface CharacterVisualLike {
  readonly root: T.Group;
  update(animation: DadAnimation): void;
  dispose(): void;
}
export type ClubCharacterVisual = CharacterVisualLike;

/** Distinct temporary casting, not inferred likenesses of the real members. */
const STAND_INS: Record<
  Exclude<ClubMemberId, "joe">,
  CharacterVisualOptions
> = {
  lou: {
    name: "Lou · provisional club character",
    hairStyle: "swept",
    palette: {
      jacket: 0x793c43,
      seams: 0x522a30,
      shirt: 0xdad1bb,
      hair: 0x706a64,
    },
  },
  chris: {
    name: "Chris · provisional club character",
    hairStyle: "short",
    palette: {
      jacket: 0xd5cbb0,
      seams: 0xa89c80,
      shirt: 0x344d63,
      hair: 0x483d31,
    },
  },
  craig: {
    name: "Craig · provisional club character",
    hairStyle: "curly",
    palette: {
      jacket: 0x626c43,
      seams: 0x414a30,
      shirt: 0xd3c7ae,
      hair: 0x3f3430,
    },
  },
  ed: {
    name: "Ed · provisional club character",
    hairStyle: "receding",
    palette: {
      jacket: 0x2c4261,
      seams: 0x1f2e46,
      shirt: 0xc4ced1,
      hair: 0xb5b1a7,
    },
  },
};

/** Retains Joe's authored Blender character; buddies can be replaced independently. */
export function createClubCharacter(
  memberId: ClubMemberId,
  source: Pick<GLTF, "scene" | "animations">,
  wheel: SteeringWheelSpec,
  seatAnchor: readonly [number, number, number] = CHARACTER_SEAT_ANCHOR,
): CharacterVisualLike {
  const character =
    memberId === "joe"
      ? new DadCharacterVisual(source, wheel, seatAnchor)
      : new CharacterVisual({ ...STAND_INS[memberId], wheel, seatAnchor });
  Object.assign(character.root.userData.character, {
    memberId,
    name: memberId[0].toUpperCase() + memberId.slice(1),
    provisional: memberId !== "joe",
    ...(memberId !== "joe"
      ? {
          source: "procedural club stand-in",
          authoring: "Articulated provisional model",
          likeness: "Neutral placeholder; not based on a supplied photo",
        }
      : {}),
  });
  return character;
}
