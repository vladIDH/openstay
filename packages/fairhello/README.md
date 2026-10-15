# fairhello

Draft replies to the guests of a short-term rental, on the host's computer. *0.1.0, in development.*

Fairhello is the part of [OpenStay](https://github.com/vladIDH/openstay) that answers guests. Hosts use it through the `fairnight risposte` commands and the `/risposte` page of [fairnight-cli](https://github.com/vladIDH/openstay/tree/main/packages/fairnight-cli): messages are read from Smoobu or Beds24 with the host's own key, a model writes a draft, and **the host approves every reply before it is sent**. Nothing is sent on its own.

This package is the library underneath: no network, no files, no dependencies.

## What it does

- **The house file** (`parseHouse`): `casa/<listing>.md`, plain Markdown written by the host. Every `## ` heading is a section the assistant may use. The access codes section (`## Codici`, `## Códigos`, `## Access codes`) is kept apart, and amounts of money in the file are reported so the host can take them out.
- **The request** (`buildPrompt`): the rules and the house file in the system part, the same for every message of a listing so a provider can cache it; the stay, the conversation and, only during the stay, the access codes in the user part. The guest's words are inside tags and treated as text to answer, never as instructions.
  - **No prices, ever.** The model never sees one, is told never to write one, and a draft that contains one anyway (`findPrices`) cannot be approved until the host edits it.
  - **Access codes** (`codesState`): from the day of check-in to the day of check-out, and, when the listing registers its guests with Fairguest, only once someone is registered.
  - **Language:** the reply is in the language of the guest's last message.
  - **Context from the other OpenStay tools**: check-in and check-out times, whether the guest registration is done, and the free nights right before and after the stay (dates only).
- **Freshness** (`checkFreshness`): a draft can be sent only if it is the newest of its conversation, answers the guest's last message, the booking is not cancelled and the stay ended at most 2 days ago. The same check runs when the draft is shown and again right before sending.
- **Sensitive topics** (`topicsOf`): money, complaints, cancellations and emergencies in Italian, Spanish, English, French, German and Portuguese. The draft is marked for the host.
- **The model** (`anthropicRequest`/`readAnthropic`, `ollamaRequest`/`readOllama`): the shapes of the requests and answers for Anthropic (default `claude-haiku-5-5`, with the host's own key) and for a model running on the host's computer with Ollama. The caller sends them.
- **Plain text** (`plainText`): markdown taken out of the draft, since the channels do not render it.
- **Matching names** (`matchName`): suggests which listing a channel's name belongs to. Two units that tie are reported as ambiguous, never guessed.

## License

AGPL-3.0-only. See [LICENSE](LICENSE).
