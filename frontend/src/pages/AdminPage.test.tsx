/*
This file checks the admin question editor form and its saved-answer format.
Edit it when question fields or editor validation change; copy a form case for another admin tool.
*/

import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminPage } from "./AdminPage";

const { postJson } = vi.hoisted(() => ({ postJson: vi.fn() }));
vi.mock("../shared/api", () => ({ postJson }));

describe("AdminPage", () => {
  beforeEach(() =>
    postJson.mockReset().mockImplementation((path: string) => Promise.resolve(path === "/admin/users/list" ? { users: [] } : { questions: [] })),
  );

  it("searches the full question bank using misspelled answers and aliases", async () => {
    const questions = [
      { id: 1, prompt: "Name a stringed instrument.", hint: "", category: "Music", use_model: true, answers: [{ answer: "Violin", aliases: ["Fiddle"], tier: "plankton" }] },
      { id: 2, prompt: "Name a string theory.", hint: "", category: "Mathematics", use_model: false, answers: [] },
    ];
    postJson.mockImplementation((path: string) => Promise.resolve(path === "/admin/users/list" ? { users: [] } : { questions }));
    const user = userEvent.setup();
    render(<AdminPage />);
    await screen.findByRole("heading", { name: questions[1].prompt });
    const search = screen.getByRole("searchbox", { name: "Search questions" });
    await user.type(search, "music fidlde violn");
    expect(screen.getByRole("heading", { name: questions[0].prompt })).toBeVisible();
    expect(screen.queryByRole("heading", { name: questions[1].prompt })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("1 of 2 prompts");
  });

  it("saves a prompt with rarity tiers and aliases", async () => {
    const user = userEvent.setup();
    render(<AdminPage />);
    await screen.findByText("Saved prompts");
    await user.type(screen.getByLabelText("Question prompt"), "Name a moon of Jupiter.");
    await user.clear(screen.getByLabelText("Category", { exact: true }));
    await user.type(screen.getByLabelText("Category", { exact: true }), "Space");
    const extraAnswers = ["Europa", "Ganymede", "Callisto", "Amalthea", "Himalia", "Thebe", "Elara", "Metis", "Adrastea", "Pasiphae", "Sinope", "Lysithea", "Ananke"];
    await user.click(screen.getByLabelText("Accepted answers"));
    await user.paste(["plankton | Io | Io moon", "deep_cut | Carme", ...extraAnswers.map((answer) => `schooler | ${answer}`)].join("\n"));
    await user.click(screen.getByRole("button", { name: "Add question" }));

    await waitFor(() =>
      expect(postJson).toHaveBeenCalledWith("/game/questions/save", {
        id: undefined,
        prompt: "Name a moon of Jupiter.",
        use_model: true,
        hint: "",
        category: "Space",
        answers: [
          { tier: "plankton", answer: "Io", aliases: ["Io moon"] },
          { tier: "deep_cut", answer: "Carme", aliases: [] },
          ...extraAnswers.map((answer) => ({ tier: "schooler", answer, aliases: [] })),
        ],
      }),
    );
    expect(await screen.findByText("Question saved.")).toBeInTheDocument();
  });

  it("shows a clear error for an invalid answer tier", async () => {
    const user = userEvent.setup();
    render(<AdminPage />);
    await screen.findByText("Saved prompts");
    await user.type(screen.getByLabelText("Question prompt"), "Name a moon of Jupiter.");
    await user.type(screen.getByLabelText("Accepted answers"), "common | Io");
    await user.click(screen.getByRole("button", { name: "Add question" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Use: tier | answer | optional aliases");
    expect(postJson).not.toHaveBeenCalledWith("/game/questions/save", expect.anything());
  });

  it("lets an admin create an account for a new player", async () => {
    const user = userEvent.setup();
    render(<AdminPage />);
    await screen.findByText("Saved prompts");
    await user.type(screen.getByLabelText("Username", { selector: "input" }), "oceanfriend");
    await user.type(screen.getByLabelText("Temporary password"), "deep-ocean-pass");
    await user.click(screen.getByRole("button", { name: "Create player account" }));
    await waitFor(() => expect(postJson).toHaveBeenCalledWith("/admin/users/create", { username: "oceanfriend", password: "deep-ocean-pass" }));
    expect(await screen.findByText(/player account created/i)).toBeInTheDocument();
  });
});
