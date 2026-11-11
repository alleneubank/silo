import { unknownDocTopicMessage } from "../utils/breadcrumbs";
import { SiloError } from "../utils/errors";
import { DOC_TOPICS, DOC_TOPIC_ALIASES } from "./doc-topics";

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

  process.stdout.write(entry.contents.trimEnd() + "\n");
};
