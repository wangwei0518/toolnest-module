import { createReadStream } from "node:fs";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { DomainError, WorkflowTicketsService } from "./service.js";

type Body = Record<string, unknown>;
type Params = Record<string, string>;

function body(request: FastifyRequest): Body {
  return request.body && typeof request.body === "object" && !Array.isArray(request.body) ? request.body as Body : {};
}

function params(request: FastifyRequest): any {
  return request.params as Params;
}

function actor(request: FastifyRequest): string {
  return typeof request.headers["x-toolnest-user-name"] === "string" ? request.headers["x-toolnest-user-name"] : "当前用户";
}

function actorId(request: FastifyRequest): string {
  return typeof request.headers["x-toolnest-user-id"] === "string" ? request.headers["x-toolnest-user-id"] : "";
}

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof DomainError) return reply.code(error.statusCode).send({ code: error.statusCode, message: error.message, data: null });
  const message = error instanceof Error ? error.message : String(error);
  return reply.code(500).send({ code: 500, message, data: null });
}

function run(reply: FastifyReply, operation: () => unknown | Promise<unknown>) {
  return Promise.resolve().then(operation).then((value) => reply.send({ data: value })).catch((error) => sendError(reply, error));
}

function registerScheduleItemRoutes(app: FastifyInstance, service: WorkflowTicketsService) {
  const prefix = "/schedule-items";
  app.get(prefix, (request, reply) => run(reply, () => service.listScheduleItems(Boolean((request.query as Body).include_archived))));
  app.post(prefix, (request, reply) => run(reply, () => service.createScheduleItem(body(request), actor(request))));
  app.post(`${prefix}/:itemId/convert`, (request, reply) => run(reply, () => service.convertScheduleItem(params(request).itemId, body(request), actor(request))));
  app.post(`${prefix}/:itemId/archive`, (request, reply) => run(reply, () => service.archiveScheduleItem(params(request).itemId)));
  app.post(`${prefix}/:itemId/completion`, (request, reply) => run(reply, () => service.updateScheduleItem(params(request).itemId, { completed: body(request).completed ?? true })));
  app.put(`${prefix}/:itemId`, (request, reply) => run(reply, () => service.updateScheduleItem(params(request).itemId, body(request))));
}

export function registerRoutes(app: FastifyInstance, service: WorkflowTicketsService) {
  app.get("/overview", (request, reply) => run(reply, () => service.overview()));
  app.get("/timeline", (request, reply) => {
    const query = request.query as Body;
    return run(reply, () => query.aggregate === "day"
      ? service.timelineActivity(typeof query.since === "string" ? query.since : undefined, typeof query.until === "string" ? query.until : undefined, typeof query.timezone === "string" ? query.timezone : "UTC", typeof query.project_id === "string" ? query.project_id : undefined)
      : service.timeline(typeof query.ticket_id === "string" ? query.ticket_id : undefined, Number(query.limit) || 30, typeof query.project_id === "string" ? query.project_id : undefined, typeof query.milestone_id === "string" ? query.milestone_id : undefined));
  });

  app.get("/workflows", (request, reply) => run(reply, () => service.listWorkflows(textQuery(request, "keyword"))));
  app.post("/workflows", (request, reply) => run(reply, () => service.createWorkflow(body(request))));
  app.get("/workflows/:workflowId", (request, reply) => run(reply, () => service.getWorkflow(params(request).workflowId)));
  app.put("/workflows/:workflowId", (request, reply) => run(reply, () => service.updateWorkflow(params(request).workflowId, body(request))));
  app.post("/workflows/:workflowId/archive", (request, reply) => run(reply, () => service.archiveWorkflow(params(request).workflowId)));
  app.post("/workflows/:workflowId/versions", (request, reply) => run(reply, () => service.createVersion(params(request).workflowId, body(request))));
  app.post("/workflows/:workflowId/publish", (request, reply) => run(reply, () => service.publishWorkflow(params(request).workflowId, body(request))));
  app.get("/workflows/:workflowId/versions/compare", (request, reply) => { const query = request.query as Body; return run(reply, () => service.compareVersions(params(request).workflowId, text(query.base_version_id), text(query.target_version_id))); });
  app.post("/workflows/:workflowId/dry-run", (request, reply) => run(reply, () => service.dryRun(params(request).workflowId, body(request))));

  app.get("/workflows/:workflowId/schedules", (request, reply) => run(reply, () => service.listSchedules(params(request).workflowId)));
  app.post("/workflows/:workflowId/schedules", (request, reply) => run(reply, () => service.createSchedule(params(request).workflowId, body(request))));
  app.put("/workflows/:workflowId/schedules/:scheduleId", (request, reply) => run(reply, () => service.updateSchedule(params(request).scheduleId, body(request))));
  app.delete("/workflows/:workflowId/schedules/:scheduleId", (request, reply) => run(reply, () => service.deleteSchedule(params(request).scheduleId)));
  app.get("/workflows/:workflowId/schedules/:scheduleId/runs", (request, reply) => run(reply, () => service.listScheduleRuns(params(request).scheduleId, Number((request.query as Body).limit) || 30)));
  app.post("/workflows/:workflowId/schedules/:scheduleId/run", (request, reply) => run(reply, () => service.runScheduleNow(params(request).scheduleId)));

  app.get("/tickets", (request, reply) => { const query = request.query as Body; return run(reply, () => service.listTickets({ ...query, owner_id: query.owner_id ?? actorId(request), owner_name: query.owner_name ?? actor(request) })); });
  app.post("/tickets", (request, reply) => run(reply, () => service.createTicket(body(request), actor(request))));
  app.put("/tickets/:ticketId", (request, reply) => run(reply, () => service.updateTicket(params(request).ticketId, body(request))));
  app.get("/tickets/:ticketId", (request, reply) => run(reply, () => service.getTicket(params(request).ticketId)));
  app.delete("/tickets/:ticketId", (request, reply) => run(reply, () => service.deleteTicket(params(request).ticketId)));
  app.post("/tickets/:ticketId/duplicate", (request, reply) => run(reply, () => service.duplicateTicket(params(request).ticketId, body(request), actor(request))));
  app.post("/tickets/bulk-update", (request, reply) => run(reply, () => service.bulkUpdate(body(request))));
  app.post("/tickets/:ticketId/nodes/:nodeId/save", (request, reply) => run(reply, () => service.saveNode(params(request).ticketId, params(request).nodeId, (body(request).values ?? {}) as Body)));
  app.post("/tickets/:ticketId/nodes/:nodeId/complete", (request, reply) => run(reply, () => service.completeNode(params(request).ticketId, params(request).nodeId)));
  app.post("/tickets/:ticketId/nodes/:nodeId/block", (request, reply) => run(reply, () => service.blockNode(params(request).ticketId, params(request).nodeId, text(body(request).reason))));
  app.post("/tickets/:ticketId/nodes/:nodeId/rollback", (request, reply) => run(reply, () => service.rollbackNode(params(request).ticketId, params(request).nodeId, text(body(request).target_node_id), text(body(request).reason))));
  app.post("/tickets/:ticketId/cancel", (request, reply) => run(reply, () => service.cancelTicket(params(request).ticketId, text(body(request).reason))));
  app.post("/tickets/:ticketId/reopen", (request, reply) => run(reply, () => service.reopenTicket(params(request).ticketId)));
  app.get("/tickets/:ticketId/diagnostics", (request, reply) => run(reply, () => service.diagnostics(params(request).ticketId)));
  app.post("/tickets/:ticketId/nodes/:nodeId/attachments", (request, reply) => run(reply, () => service.uploadAttachment(params(request).ticketId, params(request).nodeId, body(request))));
  app.delete("/attachments/:attachmentId", (request, reply) => run(reply, () => service.deleteAttachment(params(request).attachmentId)));
  app.get("/attachments/:attachmentId", async (request, reply) => { try { const item = service.getAttachment(params(request).attachmentId); return reply.type(item.attachment.mime_type).header("content-disposition", `inline; filename="${item.attachment.filename.replaceAll('"', "")}"`).send(createReadStream(item.path)); } catch (error) { return sendError(reply, error); } });
  app.get("/temp/:token", async (request, reply) => { try { const result = await service.consumeTemporaryResource(params(request).token); return reply.header("cache-control", "no-store").header("x-content-type-options", "nosniff").type(String(result.resource.mime_type ?? "text/plain")).send(result.content); } catch (error) { return sendError(reply, error); } });

  registerScheduleItemRoutes(app, service);

  app.get("/projects", (_request, reply) => run(reply, () => service.listProjects()));
  app.post("/projects", (request, reply) => run(reply, () => service.createProject(body(request), actor(request))));
  app.get("/projects/:projectId", (request, reply) => run(reply, () => service.getProject(params(request).projectId)));
  app.put("/projects/:projectId", (request, reply) => run(reply, () => service.updateProject(params(request).projectId, body(request))));
  app.post("/projects/:projectId/archive", (request, reply) => run(reply, () => service.archiveProject(params(request).projectId)));
  app.get("/projects/:projectId/analytics", (request, reply) => run(reply, () => service.projectAnalytics(params(request).projectId)));
  app.get("/projects/:projectId/milestones", (request, reply) => run(reply, () => service.listMilestones(params(request).projectId)));
  app.post("/projects/:projectId/milestones", (request, reply) => run(reply, () => service.createMilestone(params(request).projectId, body(request))));
  app.get("/projects/:projectId/milestones/:milestoneId", (request, reply) => run(reply, () => service.getMilestone(params(request).milestoneId, params(request).projectId)));
  app.put("/projects/:projectId/milestones/:milestoneId", (request, reply) => run(reply, () => service.updateMilestone(params(request).milestoneId, body(request), params(request).projectId)));
  app.delete("/projects/:projectId/milestones/:milestoneId", (request, reply) => run(reply, () => service.deleteMilestone(params(request).milestoneId, params(request).projectId)));

  app.get("/saved-views", (_request, reply) => run(reply, () => service.listSavedViews()));
  app.post("/saved-views", (request, reply) => run(reply, () => service.createSavedView(body(request))));
  app.put("/saved-views/:viewId", (request, reply) => run(reply, () => service.updateSavedView(params(request).viewId, body(request))));
  app.delete("/saved-views/:viewId", (request, reply) => run(reply, () => service.deleteSavedView(params(request).viewId)));
  app.get("/automations", (_request, reply) => run(reply, () => service.listAutomations()));
  app.post("/automations", (request, reply) => run(reply, () => service.createAutomation(body(request))));
  app.put("/automations/:ruleId", (request, reply) => run(reply, () => service.updateAutomation(params(request).ruleId, body(request))));
  app.get("/automations/:ruleId/executions", (request, reply) => run(reply, () => service.listAutomationExecutions(params(request).ruleId, Number((request.query as Body).limit) || 30)));
  app.delete("/automations/:ruleId", (request, reply) => run(reply, () => service.deleteAutomation(params(request).ruleId)));
  app.get("/resources", (request, reply) => { const query = request.query as Body; return run(reply, () => service.listResources(text(query.project_id) || undefined, text(query.ticket_id) || undefined, text(query.milestone_id) || undefined)); });
  app.post("/resources", (request, reply) => run(reply, () => service.createResource(body(request))));
  app.put("/resources/:resourceId", (request, reply) => run(reply, () => service.updateResource(params(request).resourceId, body(request))));
  app.delete("/resources/:resourceId", (request, reply) => run(reply, () => service.deleteResource(params(request).resourceId)));

  app.get("/data/export", (_request, reply) => run(reply, () => service.exportData()));
  app.get("/data/export.csv", async (_request, reply) => {
    try {
      return reply.type("text/csv; charset=utf-8").send(await service.exportCsv());
    } catch (error) {
      return sendError(reply, error);
    }
  });
  app.post("/data/import", (request, reply) => run(reply, () => service.importData(body(request))));
  // `/settings` is reserved by the platform module-management API.
  app.get("/module-settings", (_request, reply) => run(reply, () => service.settings()));
  app.put("/module-settings", (request, reply) => run(reply, () => service.updateSettings(body(request))));
  app.get("/action-providers", (_request, reply) => run(reply, () => service.actionProviders()));
}

function textQuery(request: FastifyRequest, key: string): string {
  const value = (request.query as Body)[key]; return typeof value === "string" ? value : "";
}

function text(value: unknown): string { return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim(); }
