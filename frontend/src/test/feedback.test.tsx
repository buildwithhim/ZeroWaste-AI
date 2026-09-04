/**
 * Post-meal feedback: the Smart Plate learning loop's only input.
 *
 * Covers the optimistic write, the offline hold-and-retry, the one-answer-per-
 * meal rule and the privacy promise the UI makes to the employee.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../services/feedbackService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/feedbackService")>();
  return { ...actual, submitFeedback: vi.fn() };
});

import { submitFeedback, LEFTOVER_RATE, FEEDBACK_RESPONSES } from "../services/feedbackService";
import { FeedbackProvider, useFeedback } from "../context/FeedbackContext";
import MealFeedback from "../components/MealFeedback";
import type { Booking } from "../context/BookingContext";

const mockedSubmit = vi.mocked(submitFeedback);
const STORAGE_KEY = "zerowaste-meal-feedback";
const EMPLOYEE_KEY = "zerowaste-employee-id";

const booking = (overrides: Partial<Booking> = {}): Booking => ({
  id: "Monday-Lunch",
  day: "Monday",
  category: "Lunch",
  item: { id: 3, name: "Veg Biryani", category: "Lunch", description: "Spiced rice", calories: 620, protein: 14, price: 120, image: "biryani.jpg", isVeg: true },
  appetite: "Regular",
  bookedAt: "2025-01-06T08:00:00.000Z",
  servedOn: "2025-01-06",
  ...overrides,
});

const impact = { totalResponses: 12, dishPortionMultiplier: 0.94, menuFamily: "Rice Bowl" };

function renderFeedback(target = booking()) {
  return render(
    <FeedbackProvider>
      <MealFeedback booking={target} />
    </FeedbackProvider>
  );
}

beforeEach(() => {
  localStorage.setItem(EMPLOYEE_KEY, "emp-feedback-tester");
  mockedSubmit.mockResolvedValue({ data: { recorded: {}, impact } } as never);
});

describe("the response scale", () => {
  it("offers exactly the four supported responses", () => {
    renderFeedback();
    for (const label of FEEDBACK_RESPONSES) {
      expect(screen.getByRole("button", { name: new RegExp(label) })).toBeInTheDocument();
    }
    expect(screen.getAllByRole("button")).toHaveLength(4);
  });

  it("mirrors the backend leftover model", () => {
    // Kept in step with RESPONSE_MODEL in backend/lib/feedbackModel.js. A drift
    // here silently changes every waste estimate the employee is shown.
    expect(LEFTOVER_RATE).toEqual({ Finished: 0, "Left some": 0.3, "Left most": 0.7, "Wanted more": 0 });
  });

  it("starts with nothing selected", () => {
    renderFeedback();
    for (const label of FEEDBACK_RESPONSES) {
      expect(screen.getByRole("button", { name: new RegExp(label) })).toHaveAttribute("aria-pressed", "false");
    }
  });

  it("promises anonymity before an answer is given", () => {
    renderFeedback();
    expect(screen.getByText(/Admins only ever see combined totals/i)).toBeInTheDocument();
  });
});

describe("submitting a response", () => {
  it("posts the response with the booking's own service date", async () => {
    const user = userEvent.setup();
    renderFeedback();
    await user.click(screen.getByRole("button", { name: /Left some/ }));
    await waitFor(() => expect(mockedSubmit).toHaveBeenCalled());
    expect(mockedSubmit.mock.calls[0][0]).toMatchObject({
      employeeId: "emp-feedback-tester",
      bookingId: "Monday-Lunch",
      dish: "Veg Biryani",
      category: "Lunch",
      weekday: "Monday",
      response: "Left some",
      servedOn: "2025-01-06",
      portionSize: "Regular",
    });
  });

  it("carries the plate size the meal was booked with", async () => {
    const user = userEvent.setup();
    renderFeedback(booking({ appetite: "Heavy" }));
    await user.click(screen.getByRole("button", { name: /Finished/ }));
    await waitFor(() => expect(mockedSubmit).toHaveBeenCalled());
    expect(mockedSubmit.mock.calls[0][0].portionSize).toBe("Heavy");
  });

  it("sends a pseudonym, never a name or address", async () => {
    const user = userEvent.setup();
    renderFeedback();
    await user.click(screen.getByRole("button", { name: /Finished/ }));
    await waitFor(() => expect(mockedSubmit).toHaveBeenCalled());
    const payload = JSON.stringify(mockedSubmit.mock.calls[0][0]);
    expect(payload).toContain("emp-feedback-tester");
    expect(payload).not.toMatch(/@/);
  });

  it("marks the chosen option and confirms once the server accepts", async () => {
    const user = userEvent.setup();
    renderFeedback();
    await user.click(screen.getByRole("button", { name: /Finished/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Finished/ })).toHaveAttribute("aria-pressed", "true"));
    expect(await screen.findByText(/pooled anonymously/i)).toBeInTheDocument();
  });

  it("replaces an earlier answer rather than recording two", async () => {
    const user = userEvent.setup();
    renderFeedback();
    await user.click(screen.getByRole("button", { name: /Finished/ }));
    await waitFor(() => expect(mockedSubmit).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: /Left most/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Left most/ })).toHaveAttribute("aria-pressed", "true"));
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    expect(stored.filter((entry: { bookingId: string }) => entry.bookingId === "Monday-Lunch")).toHaveLength(1);
    expect(stored.at(-1).response).toBe("Left most");
    expect(screen.getByRole("button", { name: /Finished/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("keeps separate answers for separate meals", async () => {
    const user = userEvent.setup();
    render(
      <FeedbackProvider>
        <MealFeedback booking={booking()} />
        <MealFeedback booking={booking({ id: "Tuesday-Breakfast", day: "Tuesday", category: "Breakfast" })} />
      </FeedbackProvider>
    );
    const [firstFinished, secondFinished] = screen.getAllByRole("button", { name: /Finished/ });
    await user.click(firstFinished);
    await waitFor(() => expect(firstFinished).toHaveAttribute("aria-pressed", "true"));
    expect(secondFinished).toHaveAttribute("aria-pressed", "false");
  });
});

describe("offline behaviour", () => {
  it("keeps the answer on the device when the server is unreachable", async () => {
    mockedSubmit.mockRejectedValue(new Error("offline"));
    const user = userEvent.setup();
    renderFeedback();
    await user.click(screen.getByRole("button", { name: /Left some/ }));
    expect(await screen.findByText(/Saved on this device/i)).toBeInTheDocument();
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    expect(stored[0]).toMatchObject({ response: "Left some", synced: false });
  });

  it("flushes an answer held from an earlier visit", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { bookingId: "Monday-Lunch", dish: "Veg Biryani", category: "Lunch", weekday: "Monday", portionSize: "Regular", response: "Finished", servedOn: "2025-01-06", submittedAt: "2025-01-06T13:00:00.000Z", synced: false },
      ])
    );
    renderFeedback();
    await waitFor(() => expect(mockedSubmit).toHaveBeenCalled());
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
      expect(stored[0].synced).toBe(true);
    });
  });

  it("does not re-post an answer the server already has", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { bookingId: "Monday-Lunch", dish: "Veg Biryani", category: "Lunch", weekday: "Monday", portionSize: "Regular", response: "Finished", servedOn: "2025-01-06", submittedAt: "2025-01-06T13:00:00.000Z", synced: true },
      ])
    );
    renderFeedback();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mockedSubmit).not.toHaveBeenCalled();
  });
});

describe("stored history", () => {
  function History() {
    const { feedback, pendingSyncCount } = useFeedback();
    return (
      <div>
        <span data-testid="entries">{feedback.map((f) => `${f.bookingId}:${f.response}`).join("|")}</span>
        <span data-testid="pending">{pendingSyncCount}</span>
      </div>
    );
  }

  const renderHistory = () =>
    render(
      <FeedbackProvider>
        <History />
      </FeedbackProvider>
    );

  it("migrates responses from the older three-option scale", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { bookingId: "Monday-Lunch", dish: "Veg Biryani", response: "Finished meal", servedOn: "2025-01-06", submittedAt: "2025-01-06T13:00:00.000Z", synced: true },
        { bookingId: "Tuesday-Lunch", dish: "Rajma Chawal", response: "Still hungry", servedOn: "2025-01-07", submittedAt: "2025-01-07T13:00:00.000Z", synced: true },
      ])
    );
    renderHistory();
    expect(screen.getByTestId("entries")).toHaveTextContent("Monday-Lunch:Finished");
    expect(screen.getByTestId("entries")).toHaveTextContent("Tuesday-Lunch:Wanted more");
  });

  it("drops an entry whose response is not on the scale", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ bookingId: "Monday-Lunch", dish: "Veg Biryani", response: "Delicious", servedOn: "2025-01-06", submittedAt: "2025-01-06T13:00:00.000Z", synced: true }])
    );
    renderHistory();
    expect(screen.getByTestId("entries")).toHaveTextContent("");
  });

  it("survives corrupted storage", () => {
    localStorage.setItem(STORAGE_KEY, "not json at all");
    renderHistory();
    expect(screen.getByTestId("entries")).toHaveTextContent("");
  });

  it("counts answers still waiting to reach the server", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { bookingId: "Monday-Lunch", dish: "Veg Biryani", response: "Finished", servedOn: "2025-01-06", submittedAt: "2025-01-06T13:00:00.000Z", synced: true },
        { bookingId: "Tuesday-Lunch", dish: "Rajma Chawal", response: "Left some", servedOn: "2025-01-07", submittedAt: "2025-01-07T13:00:00.000Z", synced: false },
      ])
    );
    renderHistory();
    expect(screen.getByTestId("pending")).toHaveTextContent("1");
  });
});
