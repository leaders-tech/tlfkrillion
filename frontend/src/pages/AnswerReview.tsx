/*
This component shows accepted answers and their rarity after a dive.
Edit it when the results table changes; copy the disclosure pattern for other reviews.
*/

import { useState } from "react";
import type { ReviewQuestion } from "../shared/types";

export function AnswerReview({ questions }: { questions: ReviewQuestion[] }) {
  return (
    <details className="answer-review">
      <summary>Review accepted answers</summary>
      {questions.map((question, index) => (
        <QuestionReview key={index} question={question} round={index + 1} />
      ))}
    </details>
  );
}

function QuestionReview({ question, round }: { question: ReviewQuestion; round: number }) {
  const [open, setOpen] = useState(false);
  return (
    <details name="answer-review-round" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{round}. {question.prompt}</summary>
      {open && (
        <table aria-label={`Accepted answers for prompt ${round}`}>
          <caption>{question.category}</caption>
          <thead>
            <tr><th scope="col">Answer</th><th scope="col">Rarity</th><th scope="col">Points</th></tr>
          </thead>
          <tbody>
            {question.answers.map(({ answer, tier, points }) => (
              <tr key={answer}>
                <td>{answer}</td>
                <td className={`tier-${tier}`}>{tier === "krillion" ? "One in a Krillion" : tier.replaceAll("_", " ")}</td>
                <td>{points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </details>
  );
}
