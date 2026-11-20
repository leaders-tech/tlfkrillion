/*
Test which skin rewards appear and when they replay.
Edit this file when skin reveal behavior changes.
*/

import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { SkinUnlockReveal } from "./SkinUnlockReveal";

it("shows multiple earned skins and replays only for a different dive", () => {
  const skins = [{ id: "first", name: "Sunbleached" }, { id: "ranked1", name: "Ranked Ember" }];
  const view = render(<SkinUnlockReveal key="dive-a" matchId="dive-a" playerId={35} skins={skins} />);
  const rewards = () => screen.getByRole("region", { name: "Skin rewards" });
  const cards = within(rewards()).getAllByRole("listitem");
  expect(rewards()).toHaveAttribute("data-reveal", "true");
  expect(cards[0]).toHaveTextContent("Sunbleached");
  expect(cards[1]).toHaveTextContent("Ranked Ember");
  expect(cards[1].querySelector("img")).toHaveAttribute("src", "/skins/ranked1.png");

  view.rerender(<SkinUnlockReveal key="reopened-dive-a" matchId="dive-a" playerId={35} skins={skins} />);
  expect(rewards()).toHaveAttribute("data-reveal", "false");
  expect(within(rewards()).getAllByRole("listitem")).toHaveLength(2);

  view.rerender(<SkinUnlockReveal key="dive-b" matchId="dive-b" playerId={35} skins={skins} />);
  expect(rewards()).toHaveAttribute("data-reveal", "true");
});
