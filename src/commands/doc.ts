import path from "path";
import { unknownDocTopicMessage } from "../utils/breadcrumbs";
import { SiloError } from "../utils/errors";
import { DOC_TOPICS, DOC_TOPIC_ALIASES } from "./doc-topics";

const findDocPath = async (filename: string): Promise<string | null> => {
  const candidates = [
    path.resolve(import.meta.dir, "..", "docs", filename),
    path.resolve(import.meta.dir, "..", "..", "docs", filename),
  ];

  for (const candidate of candidates) {
    const file = Bun.file(candidate);
    if (await file.exists()) {
      return candidate;
    }
  }

  return null;
};

const listTopics = (): Array<{ topic: string; file: string; description: string }> =>
  Object.entries(DOC_TOPICS).map(([topic, entry]) => ({
    topic,
    file: entry.file,
    description: entry.description,
  }));

const printTopics = (): void => {
  console.log("Available docs:");
  listTopics().forEach((topic) => {
    console.log(`  ${topic.topic}  ${topic.description}`);
  });
};

export const doc = async (params: {
  topic?: string;
  list?: boolean;
  json?: boolean;
}): Promise<void> => {
  const { topic, list, json } = params;
  if (json) {
    console.log(JSON.stringify({ topics: listTopics() }, null, 2));
    return;
  }

  if (list) {
    listTopics().forEach((entry) => {
      console.log(entry.topic);
    });
    return;
  }

  if (!topic) {
    printTopics();
    return;
  }

  const topicKey = topic.toLowerCase();
  const canonicalTopic = DOC_TOPIC_ALIASES[topicKey] ?? topicKey;
  const entry = DOC_TOPICS[canonicalTopic];
  if (!entry) {
    throw new SiloError(
      unknownDocTopicMessage(topic, Object.keys(DOC_TOPICS)),
      "DOC_NOT_FOUND"
    );
  }

  const docPath = await findDocPath(entry.file);
  if (!docPath) {
    throw new SiloError(`Doc file not found: ${entry.file}`, "DOC_NOT_FOUND");
  }

  const contents = await Bun.file(docPath).text();
  process.stdout.write(contents.trimEnd() + "\n");
};
