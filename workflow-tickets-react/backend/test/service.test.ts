import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import { DomainError, WorkflowTicketsService } from "../src/service.js";
import { JsonStore } from "../src/store.js";

const temporaryDirectories: string[] = [];

async function createService() {
  const directory = await mkdtemp(path.join(tmpdir(), "workflow-tickets-react-"));
  temporaryDirectories.push(directory);
  const service = new WorkflowTicketsService(new JsonStore(directory), "workflow-tickets-react");
  await service.init();
  return service;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("workflow ticket runtime", () => {
  it("keeps immutable published versions and enforces completion at the right boundary", async () => {
    const service = await createService();
    const workflow = service.listWorkflows()[0]!;
    const published = workflow.versions.find((version) => version.status === "published")!;
    const ticket = await service.createTicket({ workflow_id: workflow.id, title: "版本绑定测试" });

    assert.equal(ticket.number, "TK-001");
    assert.equal(ticket.workflow_version_id, published.id);
    assert.equal(ticket.node_instances[0]?.status, "ready");

    await service.saveNode(ticket.id, ticket.node_instances[0]!.id, {});
    await assert.rejects(
      () => service.completeNode(ticket.id, ticket.node_instances[0]!.id),
      (error: unknown) => error instanceof DomainError && error.statusCode === 422,
    );

    let current = await service.saveNode(ticket.id, ticket.node_instances[0]!.id, { context: "输入已准备" });
    current = await service.completeNode(ticket.id, current.node_instances[0]!.id);
    assert.equal(current.node_instances[1]?.status, "ready");
    current = await service.saveNode(current.id, current.node_instances[1]!.id, { result: "处理完成" });
    current = await service.completeNode(current.id, current.node_instances[1]!.id);
    current = await service.saveNode(current.id, current.node_instances[2]!.id, { confirmed: true });
    current = await service.completeNode(current.id, current.node_instances[2]!.id);

    assert.equal(current.status, "completed");
    assert.ok(service.timeline(current.id).some((event) => event.type === "ticket_completed"));

    const draft = await service.createVersion(workflow.id, { source_version_id: published.id });
    assert.equal(draft.status, "draft");
    const refreshed = service.getWorkflow(workflow.id);
    assert.equal(refreshed.versions.find((version) => version.id === published.id)?.status, "published");
    assert.equal(service.getTicket(ticket.id).workflow_version_id, published.id);
  });

  it("aggregates timeline activity by local calendar day", async () => {
    const service = await createService();
    const event = (id: string, title: string, created_at: string) => ({ id, type: "ticket_updated", title, detail: "", ticket_id: null, node_id: null, project_id: null, milestone_id: null, created_at, actor_name: "当前用户" });
    service.data.timeline.push(
      event("event-1", "工单已更新", "2026-09-03T16:30:00.000Z"),
      event("event-2", "节点已完成", "2026-09-04T01:00:00.000Z"),
      event("event-3", "范围外更新", "2026-09-04T16:00:00.000Z"),
    );

    assert.deepEqual(
      service.timelineActivity("2026-09-03T16:00:00.000Z", "2026-09-04T16:00:00.000Z", "Asia/Shanghai"),
      { total: 2, days: [{ date: "2026-09-04", count: 2, samples: ["工单已更新", "节点已完成"] }] },
    );
  });

  it("keeps project labels and ticket relations across create, update, and duplicate", async () => {
    const service = await createService();
    const workflow = service.listWorkflows()[0]!;
    const project = await service.createProject({ name: "发布项目", status: "active" });
    const milestone = await service.createMilestone(project.id, { name: "准备阶段" });
    const related = await service.createTicket({ workflow_id: workflow.id, title: "关联工单" });
    const ticket = await service.createTicket({ workflow_id: workflow.id, title: "主工单", project_id: project.id, milestone_id: milestone.id, weight: 7 });

    assert.equal(ticket.project_name, "发布项目");
    assert.equal(ticket.milestone_name, "准备阶段");
    const updated = await service.updateTicket(ticket.id, { parent_ticket_id: related.id, related_ticket_ids: [related.id], blocked_by_ticket_ids: [related.id] });
    assert.deepEqual(updated.related_ticket_ids, [related.id]);
    assert.equal(updated.parent_ticket_id, related.id);

    const duplicate = await service.duplicateTicket(ticket.id, { copy_project: true, copy_relations: true, copy_values: true });
    assert.equal(duplicate.project_name, "发布项目");
    assert.equal(duplicate.milestone_name, "准备阶段");
    assert.deepEqual(duplicate.related_ticket_ids, [related.id]);
    assert.equal(duplicate.parent_ticket_id, related.id);
  });

  it("renders script resources safely and limits consumption", async () => {
    const service = await createService();
    const workflow = service.listWorkflows()[0]!;
    const published = workflow.versions.find((version) => version.status === "published")!;
    const nodes = structuredClone(published.nodes);
    nodes[0]!.form_schema.fields.push({
      id: "bootstrap",
      type: "script",
      label: "初始化脚本",
      config: {
        language: "shell",
        filename: "bootstrap.sh",
        max_access_count: 1,
        execution_template: "#!/bin/sh\necho {{ current.values.context }}",
      },
    });
    await service.updateWorkflow(workflow.id, { version_id: published.id, nodes, edges: published.edges });
    const updated = service.getWorkflow(workflow.id);
    const draft = updated.versions.find((version) => version.status === "draft")!;
    await service.publishWorkflow(workflow.id, { version_id: draft.id });

    let ticket = await service.createTicket({ workflow_id: workflow.id, title: "脚本资源测试" });
    const root = ticket.node_instances[0]!;
    ticket = await service.saveNode(ticket.id, root.id, { context: "example.com" });
    const resource = ticket.node_instances[0]!.resources.bootstrap!;
    const token = resource.url.split("/").filter(Boolean).at(-1)!;
    assert.equal(resource.content, "#!/bin/sh\necho example.com");
    const consumed = await service.consumeTemporaryResource(token);
    assert.equal(consumed.content, "#!/bin/sh\necho example.com");
    await assert.rejects(() => service.consumeTemporaryResource(token), (error: unknown) => error instanceof DomainError && error.statusCode === 404);
  });

  it("runs automation once and keeps project notifications idempotent", async () => {
    const service = await createService();
    const workflow = service.listWorkflows()[0]!;
    await service.createAutomation({
      name: "高优先级标记",
      trigger: "ticket_created",
      conditions: { workflow_id: workflow.id },
      actions: [{ type: "set_priority", value: "urgent" }, { type: "add_tag", value: "自动化" }],
    });
    const ticket = await service.createTicket({ workflow_id: workflow.id, title: "自动化测试" });
    assert.equal(ticket.priority, "urgent");
    assert.deepEqual(ticket.tags, ["自动化"]);
    assert.equal(service.data.action_executions.filter((item) => item.ticket_id === ticket.id).length, 1);

    const project = await service.createProject({ name: "风险项目", status: "active" });
    await service.createMilestone(project.id, { name: "已到期", target_at: new Date(Date.now() - 86_400_000).toISOString() });
    assert.equal(await service.runDueProjectNotifications(), 2);
    assert.equal(await service.runDueProjectNotifications(), 0);
  });

  it("supports legacy schedule placeholders and skipped runs", async () => {
    const service = await createService();
    const workflow = service.listWorkflows()[0]!;
    const schedule = await service.createSchedule(workflow.id, {
      name: "一次性计划",
      schedule_type: "once",
      start_at: new Date(Date.now() - 60_000).toISOString(),
      title_template: "{workflow} · {year}-{month}-{day} · {time} · {sequence}",
      note_template: "{workflow} 于 {date} 第 {sequence} 次自动创建。",
    });
    assert.equal(await service.runDueSchedules(), 1);
    const run = service.listScheduleRuns(schedule.id)[0]!;
    assert.equal(run.status, "succeeded");
    const generated = service.listTickets({}) .items[0]!;
    assert.match(generated.title, / · [0-9]{4}-[0-9]{2}-[0-9]{2} · [0-9]{2}:[0-9]{2} · 001$/);
    assert.match(generated.note, /第 001 次自动创建/);

    const draftWorkflow = await service.createWorkflow({ name: "未发布模板" });
    const skipped = await service.createSchedule(draftWorkflow.id, {
      name: "等待发布",
      schedule_type: "once",
      start_at: new Date(Date.now() - 60_000).toISOString(),
    });
    assert.equal(await service.runDueSchedules(), 1);
    assert.equal(service.listScheduleRuns(skipped.id)[0]?.status, "skipped");
  });
});
