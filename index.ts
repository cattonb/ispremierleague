import { Hono } from "hono";
import { cors } from "hono/cors";
import { env } from "hono/adapter";
import { Index } from "@upstash/vector";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";

const app = new Hono();

const semanticSplitter = new RecursiveCharacterTextSplitter({
  chunkSize: 10,
  separators: [" "],
  chunkOverlap: 6,
});

type EnvType = {
  VECTOR_URL: string;
  VECTOR_TOKEN: string;
};

app.use(cors());

const WHITELIST = ["occold fc"];
const CHUNK_THRESHOLD = 0.86;

app.post("/", async (c) => {
  if (c.req.header("Content-Type") !== "application/json") {
    return c.json({ error: "JSON body expected!" }, { status: 406 });
  }

  try {
    const { VECTOR_TOKEN, VECTOR_URL } = env<EnvType>(c);

    const index = new Index({
      url: VECTOR_URL,
      token: VECTOR_TOKEN,
      cache: false,
    });

    const body = await c.req.json();

    let { message } = body as { message: string };

    if (!message) {
      return c.json({ error: "Message argument is required!!" }, { status: 400 });
    }

    if (message.length > 100) {
      return c.json({ error: "Message can only be at most 100 characters!!!" }, { status: 413 });
    }

    message = message
      .split(/\s/)
      .filter((word) => !WHITELIST.includes(word.toLowerCase()))
      .join(" ");

    const [wordChunks, semanticChunks] = await Promise.all([
      splitTextIntoWords(message),
      splitTextIntoSemantics(message),
    ]);

    const flaggedFor = new Set<{ score: number; team: string }>();

    const vectorRes = await Promise.all([
      ...wordChunks.map(async (wordChunk) => {
        console.log(wordChunk);
        const [vector] = await index.query({
          topK: 1,
          data: wordChunk,
          includeMetadata: true,
        });

        if (vector && vector.score > 0.9) {
          flaggedFor.add({
            team: vector.metadata!.team as string,
            score: vector.score,
          });
        }

        return { score: 0 };
      }),
      ...semanticChunks.map(async (semanticChunk) => {
        const [vector] = await index.query({
          topK: 1,
          data: semanticChunk,
          includeMetadata: true,
        });

        if (vector && vector.score > CHUNK_THRESHOLD) {
          flaggedFor.add({
            team: vector.metadata!.team as string,
            score: vector.score,
          });
        }

        return vector!;
      }),
    ]);

    if (flaggedFor.size > 0) {
      const sorted = Array.from(flaggedFor).sort((a, b) => (a.score > b.score ? -1 : 1))[0];

      return c.json({
        isPremierLeague: true,
        score: sorted.score,
        flaggedFor: sorted.team,
      });
    } else {
      const mostPremierChunk = vectorRes.sort((a, b) => (a.score > b.score ? -1 : 1))[0];
      return c.json({
        isPremierLeague: false,
        score: mostPremierChunk.score,
      });
    }
  } catch (err) {
    console.error(err);

    return c.json(
      {
        error: "Something went wrong!",
      },
      {
        status: 500,
      }
    );
  }
});

function splitTextIntoWords(text: string) {
  return text.split(/\s/);
}

async function splitTextIntoSemantics(text: string) {
  // We are already handling this with the word chunk function above
  if (text.split(/\s/).length === 1) return [];

  const documents = await semanticSplitter.createDocuments([text]);
  const chunks = documents.map((chunk) => chunk.pageContent);

  return chunks;
}

export default app;
