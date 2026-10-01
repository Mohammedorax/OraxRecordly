import { describe, expect, it } from "vitest";
import { getShadowFilterPadding, VIDEO_SHADOW_LAYER_PROFILES } from "./shadowProfile";

describe("VIDEO_SHADOW_LAYER_PROFILES", () => {
	it("keeps the three layer video shadow profile", () => {
		expect(VIDEO_SHADOW_LAYER_PROFILES).toHaveLength(3);
	});

	it("pads the filter bounds for the blur and offset", () => {
		expect(getShadowFilterPadding(0, 0)).toBe(0);
		expect(getShadowFilterPadding(8, -4)).toBe(20);
	});
});
