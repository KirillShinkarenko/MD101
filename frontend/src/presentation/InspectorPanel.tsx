import type { TaskContext } from "../domain/chat";

type Props = {
  taskContext: TaskContext;
};

type TaskCommandHelp = {
  command: string;
  description: string;
};

const TASK_COMMANDS: TaskCommandHelp[] = [
  { command: "/approve_plan | approve_plan", description: "Утвердить план и сразу запустить execution" },
  {
    command: "/complete_execution | complete_execution",
    description: "Завершить execution и перейти в validation",
  },
  { command: "/complete_step | complete_step", description: "Завершить текущий шаг execution" },
  { command: "/approve_validation | approve_validation", description: "Завершить validation и перейти в done" },
  { command: "/pause [reason] | pause [reason]", description: "Поставить задачу на паузу" },
  { command: "/resume | resume", description: "Снять паузу" },
  { command: "/request_replan [reason] | request_replan [reason]", description: "Вернуть задачу в planning" },
  { command: "/request_rework [reason] | request_rework [reason]", description: "Вернуть задачу в execution" },
];

export function InspectorPanel(props: Props) {
  const { taskContext } = props;

  return (
    <aside className="sidebar right-col inspector-simple-layout">
      <section className="side-section task-tab-content">
        <div className="task-fsm-card">
          <p className="task-fsm-line">
            <strong>State:</strong> <code>{taskContext.state}</code>
          </p>
        </div>
      </section>

      <section className="side-section task-command-section">
        <h3 className="task-command-title">Команды переходов</h3>
        <p className="task-fsm-warning">Команды можно вводить как со слешем, так и без слеша.</p>
        <ul className="task-command-list">
          {TASK_COMMANDS.map((item) => (
            <li key={item.command} className="task-command-item">
              <code className="task-command-code">{item.command}</code>
              <span className="task-command-description">{item.description}</span>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}
