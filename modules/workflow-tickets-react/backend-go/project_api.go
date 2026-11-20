package main

import (
	"net/http"
	"time"
)

func (app *api) registerProjects(mux *http.ServeMux) {
	app.endpoint(mux, "GET /projects", false, func(state *workflowState, _ *http.Request, _ record) (any, error) {
		items := []record{}
		now := time.Now()
		for _, project := range sortedUpdated(state.entities["projects"]) {
			if project["status"] != "archived" {
				items = append(items, state.projectRead(project, now))
			}
		}
		return items, nil
	})
	app.endpoint(mux, "POST /projects", true, func(state *workflowState, request *http.Request, body record) (any, error) {
		return state.createProject(body, actorName(request), time.Now())
	})
	const path = "/projects/{projectID}"
	for _, route := range []struct {
		method, suffix string
		write          bool
		handle         func(*workflowState, record, record, record, time.Time) (any, error)
	}{
		{"GET", "", false, func(state *workflowState, project, _, _ record, now time.Time) (any, error) {
			return state.projectRead(project, now), nil
		}},
		{"PUT", "", true, func(state *workflowState, project, _ record, body record, now time.Time) (any, error) {
			updateProject(project, body, timestamp(now))
			return state.projectRead(project, now), nil
		}},
		{"POST", "/archive", true, func(state *workflowState, project, _, _ record, now time.Time) (any, error) {
			project["status"], project["updated_at"] = "archived", timestamp(now)
			return state.projectRead(project, now), nil
		}},
		{"GET", "/analytics", false, func(state *workflowState, project, _, _ record, now time.Time) (any, error) {
			return state.projectAnalytics(project, now), nil
		}},
		{"GET", "/milestones", false, func(state *workflowState, project, _, _ record, _ time.Time) (any, error) {
			items := []record{}
			for _, item := range sortedUpdated(matchingRecords(state.entities["milestones"], "project_id", project["id"])) {
				items = append(items, state.milestoneRead(item))
			}
			return items, nil
		}},
		{"POST", "/milestones", true, func(state *workflowState, project, _ record, body record, now time.Time) (any, error) {
			return state.createMilestone(stringValue(project["id"]), body, timestamp(now))
		}},
		{"GET", "/milestones/{milestoneID}", false, func(state *workflowState, _, item, _ record, _ time.Time) (any, error) {
			return state.milestoneRead(item), nil
		}},
		{"PUT", "/milestones/{milestoneID}", true, func(state *workflowState, _, item, body record, now time.Time) (any, error) {
			updateMilestone(item, body, timestamp(now))
			return state.milestoneRead(item), nil
		}},
		{"DELETE", "/milestones/{milestoneID}", true, func(state *workflowState, _, item, _ record, _ time.Time) (any, error) {
			state.deleteMilestone(stringValue(item["id"]))
			return nil, nil
		}},
	} {
		app.endpoint(mux, route.method+" "+path+route.suffix, route.write, func(state *workflowState, request *http.Request, body record) (any, error) {
			projectID, milestoneID := request.PathValue("projectID"), request.PathValue("milestoneID")
			project := findRecord(state.entities["projects"], projectID)
			var milestone record
			if milestoneID != "" {
				milestone = findRecord(state.entities["milestones"], milestoneID)
				if milestone == nil {
					return nil, failure(404, "里程碑不存在")
				}
				if milestone["project_id"] != projectID {
					return nil, failure(404, "里程碑不属于当前项目")
				}
			}
			if project == nil {
				return nil, failure(404, "项目不存在")
			}
			return route.handle(state, project, milestone, body, time.Now())
		})
	}
}
