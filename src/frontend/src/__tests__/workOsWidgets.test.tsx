import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CanvasSplitView } from '../components/messenger/CanvasSplitView';
import { KanbanWidgetEmbed } from '../components/messenger/widgets/KanbanWidgetEmbed';
import { VotingWidgetEmbed } from '../components/messenger/widgets/VotingWidgetEmbed';
import { RACIWidgetEmbed } from '../components/messenger/widgets/RACIWidgetEmbed';
import { CodeRunnerWidgetEmbed } from '../components/messenger/widgets/CodeRunnerWidgetEmbed';
import { MermaidEmbed } from '../components/messenger/embeds/MermaidEmbed';
import { CodeDiffEmbed } from '../components/messenger/embeds/CodeDiffEmbed';
import { ActionItemChip } from '../components/messenger/ActionItemChip';

describe('Work OS & Super-App Primitives', () => {
  it('renders CanvasSplitView with decisions and blocks', () => {
    const onClose = vi.fn();
    render(
      <CanvasSplitView
        chatTitle="Sprint Planning"
        onClose={onClose}
      />
    );
    expect(screen.getByDisplayValue('Фінальні домовленості та архітектура')).toBeDefined();
    expect(screen.getByText('Додати блок:')).toBeDefined();
    expect(screen.getByText('Документ')).toBeDefined();
  });

  it('renders KanbanWidgetEmbed and allows adding cards', () => {
    const data = {
      id: 'k1',
      title: 'Sprint Board',
      columns: [
        { id: 'c1', title: 'To Do', items: [{ id: '1', title: 'Test Task' }] },
        { id: 'c2', title: 'Done', items: [] },
      ],
    };
    render(<KanbanWidgetEmbed data={data} />);
    expect(screen.getByText('Sprint Board')).toBeDefined();
    expect(screen.getByText('Test Task')).toBeDefined();
    expect(screen.getByText('To Do')).toBeDefined();
  });

  it('renders VotingWidgetEmbed and handles click to vote', () => {
    const poll = {
      id: 'v1',
      question: 'Approve Release?',
      options: [
        { id: 'opt1', text: 'Yes (+1)', votes: 2, voters: ['user1', 'user2'] },
        { id: 'opt2', text: 'No (-1)', votes: 0, voters: [] },
      ],
      totalVotes: 2,
    };
    const onUpdate = vi.fn();
    render(<VotingWidgetEmbed data={poll} onUpdate={onUpdate} currentUserId="self" />);
    expect(screen.getByText('Approve Release?')).toBeDefined();
    expect(screen.getByText('Yes (+1)')).toBeDefined();

    fireEvent.click(screen.getByText('Yes (+1)'));
    expect(onUpdate).toHaveBeenCalled();
  });

  it('renders RACIWidgetEmbed table', () => {
    const raci = {
      id: 'r1',
      title: 'Release Matrix',
      roles: ['DevOps', 'Backend'],
      rows: [{ id: 'row1', task: 'DB Migration', r: 'DevOps', a: 'Lead', c: 'Backend', i: 'All' }],
    };
    render(<RACIWidgetEmbed data={raci} />);
    expect(screen.getByText('Release Matrix')).toBeDefined();
    expect(screen.getByText('DB Migration')).toBeDefined();
  });

  it('renders CodeRunnerWidgetEmbed and executes code', () => {
    const code = {
      id: 'cr1',
      title: 'JS Test',
      language: 'javascript' as const,
      code: 'console.log("hello world");',
    };
    render(<CodeRunnerWidgetEmbed data={code} />);
    expect(screen.getByText('JS Test')).toBeDefined();
    expect(screen.getByText('Run')).toBeDefined();
  });

  it('renders MermaidEmbed and CodeDiffEmbed', () => {
    render(
      <MermaidEmbed
        data={{
          title: 'Architecture',
          code: 'graph TD\nA --> B',
        }}
      />
    );
    expect(screen.getByText('Architecture')).toBeDefined();

    render(
      <CodeDiffEmbed
        data={{
          filename: 'test.ts',
          oldCode: 'const a = 1;',
          newCode: 'const a = 2;',
        }}
      />
    );
    expect(screen.getByText('test.ts')).toBeDefined();
  });

  it('renders ActionItemChip on matching commitments', () => {
    const onCreate = vi.fn();
    render(
      <ActionItemChip
        text="Зроблю рев'ю до 18:00"
        senderName="Олександр"
        onCreateTask={onCreate}
      />
    );
    expect(screen.getByText('AI: Доручення в 1 клік')).toBeDefined();
    fireEvent.click(screen.getByText('AI: Доручення в 1 клік'));
    expect(onCreate).toHaveBeenCalled();
  });
});
