/*
This file checks the public Krillion landing screen.
Edit it when the signed-out intro or its sign-in link changes; copy its render setup for another public page.
*/

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AuthContext } from "../app/auth";
import { HomePage } from "./HomePage";

describe("HomePage", () => {
  it("shows the dive introduction and sign-in link", () => {
    render(
      <MemoryRouter>
        <AuthContext.Provider value={{ user: null, loading: false, login: vi.fn(), logout: vi.fn() }}>
          <HomePage />
        </AuthContext.Provider>
      </MemoryRouter>,
    );
    expect(screen.getByText("A deep dive for one or more players")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /sign in to dive/i })).toHaveAttribute("href", "/login");
  });
});
