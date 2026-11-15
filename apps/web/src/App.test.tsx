import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { App } from "./App.js";

describe("OpenSep app", () => {
  it("shows the free plan without payment actions", () => {
    render(<MemoryRouter initialEntries={["/plans"]}><App /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "Todo incluido" })).toBeInTheDocument();
    expect(screen.getByText("Gratis para siempre")).toBeInTheDocument();
    expect(screen.queryByText(/comprar/i)).not.toBeInTheDocument();
  });
});
