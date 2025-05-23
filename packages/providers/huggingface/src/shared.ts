import { HfInference } from "@huggingface/inference";
import { wrapLLMEvent } from "@llamaindex/core/decorator";
import { BaseEmbedding } from "@llamaindex/core/embeddings";
import {
  BaseLLM,
  type ChatMessage,
  type ChatResponse,
  type ChatResponseChunk,
  type LLMChatParamsNonStreaming,
  type LLMChatParamsStreaming,
  type LLMMetadata,
  type ToolCallLLMMessageOptions,
} from "@llamaindex/core/llms";
import { streamConverter } from "@llamaindex/core/utils";

export enum HuggingFaceEmbeddingModelType {
  XENOVA_ALL_MINILM_L6_V2 = "Xenova/all-MiniLM-L6-v2",
  XENOVA_ALL_MPNET_BASE_V2 = "Xenova/all-mpnet-base-v2",
}

/**
 * Uses feature extraction from Hugging Face's Inference API to generate embeddings.
 *
 * Set the `model` and `accessToken` parameter in the constructor, e.g.:
 * ```
 * new HuggingFaceInferenceAPIEmbedding({
 *     model: HuggingFaceEmbeddingModelType.XENOVA_ALL_MPNET_BASE_V2,
 *     accessToken: "<your-access-token>"
 * });
 * ```
 *
 * @extends BaseEmbedding
 */
export class HuggingFaceInferenceAPIEmbedding extends BaseEmbedding {
  model: string;
  hf: HfInference;

  constructor(init: HFConfig) {
    super();
    const { model, accessToken, endpoint, ...hfInferenceOpts } = init;

    this.hf = new HfInference(accessToken, hfInferenceOpts);
    this.model = model;
    if (endpoint) this.hf.endpoint(endpoint);
  }

  async getTextEmbedding(text: string): Promise<number[]> {
    const res = await this.hf.featureExtraction({
      model: this.model,
      inputs: text,
    });
    return res as number[];
  }

  getTextEmbeddings = async (texts: string[]): Promise<Array<number[]>> => {
    const res = await this.hf.featureExtraction({
      model: this.model,
      inputs: texts,
    });
    return res as number[][];
  };
}

type HfInferenceOptions = ConstructorParameters<typeof HfInference>[1];

export type HFConfig = Partial<typeof DEFAULT_PARAMS> &
  HfInferenceOptions & {
    model: string;
    accessToken: string;
    endpoint?: string;
  };

export const DEFAULT_PARAMS = {
  temperature: 0.1,
  topP: 1,
  maxTokens: undefined,
  contextWindow: 3900,
};

/**
    Wrapper on the Hugging Face's Inference API.
    API Docs: https://huggingface.co/docs/huggingface.js/inference/README
    List of tasks with models: huggingface.co/api/tasks

    Note that Conversational API is not yet supported by the Inference API.
    They recommend using the text generation API instead.
    See: https://github.com/huggingface/huggingface.js/issues/586#issuecomment-2024059308
 */
export class HuggingFaceInferenceAPI extends BaseLLM {
  model: string;
  temperature: number;
  topP: number;
  maxTokens?: number | undefined;
  contextWindow: number;
  hf: HfInference;

  constructor(init: HFConfig) {
    super();
    const {
      model,
      temperature,
      topP,
      maxTokens,
      contextWindow,
      accessToken,
      endpoint,
      ...hfInferenceOpts
    } = init;
    this.hf = new HfInference(accessToken, hfInferenceOpts);
    this.model = model;
    this.temperature = temperature ?? DEFAULT_PARAMS.temperature;
    this.topP = topP ?? DEFAULT_PARAMS.topP;
    this.maxTokens = maxTokens ?? DEFAULT_PARAMS.maxTokens;
    this.contextWindow = contextWindow ?? DEFAULT_PARAMS.contextWindow;
    if (endpoint) this.hf.endpoint(endpoint);
  }

  get metadata(): LLMMetadata {
    return {
      model: this.model,
      temperature: this.temperature,
      topP: this.topP,
      maxTokens: this.maxTokens,
      contextWindow: this.contextWindow,
      tokenizer: undefined,
      structuredOutput: false,
    };
  }

  chat(
    params: LLMChatParamsStreaming,
  ): Promise<AsyncIterable<ChatResponseChunk>>;
  chat(params: LLMChatParamsNonStreaming): Promise<ChatResponse>;
  @wrapLLMEvent
  async chat(
    params: LLMChatParamsStreaming | LLMChatParamsNonStreaming,
  ): Promise<AsyncIterable<ChatResponseChunk> | ChatResponse<object>> {
    if (params.stream) return this.streamChat(params);
    return this.nonStreamChat(params);
  }

  private messagesToPrompt(messages: ChatMessage<ToolCallLLMMessageOptions>[]) {
    let prompt = "";
    for (const message of messages) {
      if (message.role === "system") {
        prompt += `<|system|>\n${message.content}</s>\n`;
      } else if (message.role === "user") {
        prompt += `<|user|>\n${message.content}</s>\n`;
      } else if (message.role === "assistant") {
        prompt += `<|assistant|>\n${message.content}</s>\n`;
      }
    }
    // ensure we start with a system prompt, insert blank if needed
    if (!prompt.startsWith("<|system|>\n")) {
      prompt = "<|system|>\n</s>\n" + prompt;
    }
    // add final assistant prompt
    prompt = prompt + "<|assistant|>\n";
    return prompt;
  }

  protected async nonStreamChat(
    params: LLMChatParamsNonStreaming,
  ): Promise<ChatResponse> {
    const res = await this.hf.textGeneration({
      model: this.model,
      inputs: this.messagesToPrompt(params.messages),
      parameters: this.metadata,
    });
    return {
      raw: res,
      message: {
        content: res.generated_text,
        role: "assistant",
      },
    };
  }

  protected async *streamChat(
    params: LLMChatParamsStreaming,
  ): AsyncIterable<ChatResponseChunk> {
    const stream = this.hf.textGenerationStream({
      model: this.model,
      inputs: this.messagesToPrompt(params.messages),
      parameters: this.metadata,
    });
    yield* streamConverter(stream, (chunk) => ({
      delta: chunk.token.text,
      raw: chunk,
    }));
  }
}
