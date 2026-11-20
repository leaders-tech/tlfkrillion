/*
This file tests game routes, admin protection, and the shared logout message.
Edit it when top-level routes or access rules change; copy a route case for another protected page.
*/

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { AuthContext } from "./auth";
import type { User } from "../shared/types";

vi.mock("../pages/HomePage", () => ({ HomePage: () => <h2>Dive lobby</h2> }));
vi.mock("../pages/AdminPage", () => ({ AdminPage: () => <h2>Question bank</h2> }));

vi.mock("../shared/api", () => ({
  postJson: vi.fn().mockResolvedValue({
    elo: 1000, rank: { name: "Reef Runner", color: "#63eadc" }, skins: [],
    dives: 0, best_depth: 0, wins: 0, losses: 0, draws: 0, streak: 0,
  }),
}));

const userValue: User = { id: 2, username: "user", is_admin: false, created_at: "2026-03-06T10:00:00+00:00", updated_at: "2026-03-06T10:00:00+00:00" };
const adminValue: User = { ...userValue, id: 1, username: "admin", is_admin: true };

function renderApp(path: string, user: User | null, logout = vi.fn()) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthContext.Provider value={{ user, loading: false, login: vi.fn(), logout }}>
        <App />
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

describe("App routes", () => {
  it("shows login in the menu to anonymous visitors", async () => {
    renderApp("/", null);
    await userEvent.click(screen.getByRole("button", { name: "Menu" }));
    expect(screen.getByRole("link", { name: "Login" })).toHaveAttribute("href", "/login");
  });

  it("redirects normal users away from question management", () => {
    renderApp("/admin", userValue);
    expect(screen.getByRole("heading", { name: "Dive lobby" })).toBeInTheDocument();
  });

  it("shows the question bank to admins", () => {
    renderApp("/admin", adminValue);
    expect(screen.getByRole("heading", { name: "Question bank" })).toBeInTheDocument();
  });

  it("shows the not found page for unknown addresses", () => {
    renderApp("/unknown", null);
    expect(screen.getByRole("heading", { name: "Page not found" })).toBeInTheDocument();
  });

  it("shows a logout failure while keeping the current page", async () => {
    const logout = vi.fn().mockRejectedValueOnce(new Error("Could not reach the server."));
    renderApp("/", userValue, logout);
    await userEvent.click(screen.getByRole("button", { name: "Menu" }));
    await userEvent.click(screen.getByRole("button", { name: "Logout" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server.");
    expect(screen.getByRole("heading", { name: "Dive lobby" })).toBeInTheDocument();
  });

  it("opens a profile with a loaded rating and skins", async () => {
    renderApp("/", userValue);
    await userEvent.click(screen.getByRole("link", { name: "Profile" }));
    expect(await screen.findByText("Reef Runner")).toBeInTheDocument();
    for (const section of ["Skins", "Stats", "Elo"]) {
      expect(await screen.findByRole("heading", { name: section })).toBeInTheDocument();
    }
  });
});
