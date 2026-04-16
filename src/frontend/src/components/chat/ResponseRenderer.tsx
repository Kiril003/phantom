import type { ChatMessage, ChatAttachment, ResponseForm } from '@shared/types';
import { MarkdownResponse } from './MarkdownResponse';
import { CodeBlock, type CodeBlockData } from './CodeBlock';
import { ChartResponse, type ChartData } from './ChartResponse';
import { DiagramResponse, type DiagramData } from './DiagramResponse';
import { MapResponse, type MapData } from './MapResponse';
import { TerminalResponse, type TerminalData } from './TerminalResponse';
import { MetricCards, type MetricCardData } from './MetricCards';

interface ResponseRendererProps {
  message: ChatMessage;
  /** Pass true to mark this render as a live stream — skips heavy charts/map until done. */
  streaming?: boolean;
}

function attachmentByType<T>(
  attachments: ChatAttachment[] | undefined,
  type: ChatAttachment['type']
): T | null {
  if (!attachments) return null;
  const found = attachments.find((a) => a.type === type);
  return found ? (found.data as T) : null;
}

function diagramFromAttachment(attachments: ChatAttachment[] | undefined): DiagramData | null {
  if (!attachments) return null;
  // Stored as chart_data with chart_type: 'diagram', OR a dedicated diagram attachment via `map_markers` convention.
  // Prefer explicit: chart_data with kind
  const chart = attachmentByType<ChartData & { kind?: string }>(attachments, 'chart_data');
  if (chart && (chart as unknown as { diagram?: DiagramData }).diagram) {
    return (chart as unknown as { diagram: DiagramData }).diagram;
  }
  return null;
}

export function ResponseRenderer({ message, streaming = false }: ResponseRendererProps) {
  const form: ResponseForm = message.response_form;
  const content = message.content;
  const attachments = message.attachments;

  const text = content ? (
    <MarkdownResponse content={content} />
  ) : null;

  switch (form) {
    case 'text':
    case 'markdown':
      return <MarkdownResponse content={content} />;

    case 'code': {
      const data = attachmentByType<CodeBlockData>(attachments, 'code_block');
      if (!data) return text;
      return (
        <div className="flex flex-col gap-2">
          {content && <MarkdownResponse content={content} />}
          <CodeBlock data={data} />
        </div>
      );
    }

    case 'chart': {
      const data = attachmentByType<ChartData>(attachments, 'chart_data');
      if (!data) return text;
      if (streaming) return text;
      return (
        <div className="flex flex-col gap-2">
          {content && <MarkdownResponse content={content} />}
          <ChartResponse data={data} />
        </div>
      );
    }

    case 'diagram': {
      const data =
        diagramFromAttachment(attachments) ??
        (attachmentByType<DiagramData>(attachments, 'chart_data') as DiagramData | null);
      if (!data || !('nodes' in data)) return text;
      if (streaming) return text;
      return (
        <div className="flex flex-col gap-2">
          {content && <MarkdownResponse content={content} />}
          <DiagramResponse data={data} />
        </div>
      );
    }

    case 'map': {
      const data = attachmentByType<MapData>(attachments, 'map_markers');
      if (!data) return text;
      if (streaming) return text;
      return (
        <div className="flex flex-col gap-2">
          {content && <MarkdownResponse content={content} />}
          <MapResponse data={data} />
        </div>
      );
    }

    case 'terminal': {
      const data = attachmentByType<TerminalData>(attachments, 'terminal_output');
      if (!data) return text;
      return (
        <div className="flex flex-col gap-2">
          {content && <MarkdownResponse content={content} />}
          <TerminalResponse data={data} />
        </div>
      );
    }

    case 'metric_cards': {
      const data = attachmentByType<MetricCardData>(attachments, 'metric_card');
      if (!data) return text;
      return (
        <div className="flex flex-col gap-2">
          {content && <MarkdownResponse content={content} />}
          <MetricCards data={data} />
        </div>
      );
    }

    case 'mixed': {
      // Render content + every attachment in order
      const chart = attachmentByType<ChartData>(attachments, 'chart_data');
      const code = attachmentByType<CodeBlockData>(attachments, 'code_block');
      const map = attachmentByType<MapData>(attachments, 'map_markers');
      const term = attachmentByType<TerminalData>(attachments, 'terminal_output');
      const metrics = attachmentByType<MetricCardData>(attachments, 'metric_card');
      return (
        <div className="flex flex-col gap-2">
          {content && <MarkdownResponse content={content} />}
          {metrics && <MetricCards data={metrics} />}
          {chart && !streaming && <ChartResponse data={chart} />}
          {code && <CodeBlock data={code} />}
          {map && !streaming && <MapResponse data={map} />}
          {term && <TerminalResponse data={term} />}
        </div>
      );
    }

    default:
      return text;
  }
}
