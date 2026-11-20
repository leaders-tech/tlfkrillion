/*
Test Ranked queue choices and the rank table. Edit when the Ranked lobby changes.
*/

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { RankedMenu } from "./RankedMenu";

vi.mock("../shared/api", () => ({
  postJson: async () => ({
    elo: 1000,
    rank: { minimum: 900, name: "Reef Runner", color: "#63eadc" },
    ranks: [{ minimum: 900, name: "Reef Runner", color: "#63eadc" }],
    admin_rank: { minimum: 50000, name: "Abyss Architect", color: "#e7c9ff" },
    history: [],
    max_swing: 256,
  }),
}));

it("shows the rank boundaries and lets a player choose either queue option", async () => {
  const join = vi.fn();
  render(
    <MemoryRouter>
      <RankedMenu connected queueing={false} join={join} queueStatus={null} error="" />
    </MemoryRouter>,
  );
  expect(await screen.findByRole("row", { name: "Reef Runner 900" })).toBeVisible();
  expect(screen.getByText(/Finish a Ranked match/)).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Queue at any Elo" }));
  await userEvent.click(screen.getByRole("button", { name: "Find a Ranked match" }));
  expect(join.mock.calls).toEqual([[true], [false]]);
});
