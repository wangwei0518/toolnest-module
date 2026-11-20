package main

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
)

type config struct {
	moduleID, releaseID, token, dataDir, logDir                         string
	databaseURL, databaseSchema, python                                 string
	port, poolSize, outputBytes, executionSeconds, concurrentExecutions int
}

var postgresIdentifier = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

func loadConfig(get func(string) string) (config, error) {
	c := config{
		moduleID: get("TOOLNEST_PLUGIN_ID"), releaseID: get("TOOLNEST_PLUGIN_RELEASE_ID"),
		token: get("TOOLNEST_PLUGIN_TOKEN"), dataDir: get("TOOLNEST_PLUGIN_DATA_DIR"),
		logDir: get("TOOLNEST_PLUGIN_LOG_DIR"), databaseURL: get("TOOLNEST_PLUGIN_DATABASE_URL"),
		databaseSchema: get("TOOLNEST_PLUGIN_DATABASE_SCHEMA"), python: get("PYTHON_EXECUTABLE"),
	}
	for _, env := range []struct{ name, value string }{
		{"TOOLNEST_PLUGIN_TOKEN", c.token}, {"TOOLNEST_PLUGIN_DATA_DIR", c.dataDir},
		{"TOOLNEST_PLUGIN_LOG_DIR", c.logDir}, {"TOOLNEST_PLUGIN_DATABASE_URL", c.databaseURL},
	} {
		if env.value == "" {
			return c, fmt.Errorf("%s is required", env.name)
		}
	}
	if c.moduleID == "" {
		c.moduleID = "python-runner"
	}
	if c.releaseID == "" {
		c.releaseID = "development"
	}
	if c.databaseSchema == "" {
		c.databaseSchema = "public"
	}
	if !postgresIdentifier.MatchString(c.databaseSchema) || len(c.databaseSchema) > 63 {
		return c, fmt.Errorf("invalid PostgreSQL schema name")
	}
	if c.python == "" {
		c.python = "python3"
		if runtime.GOOS == "windows" {
			c.python = "python"
		}
	}
	for _, env := range []struct {
		name               string
		target             *int
		fallback, min, max int
	}{
		{"TOOLNEST_PLUGIN_PORT", &c.port, 0, 0, 65535},
		{"TOOLNEST_PLUGIN_DATABASE_POOL_MAX", &c.poolSize, 2, 1, 16},
		{"PYTHON_RUNNER_MAX_OUTPUT_BYTES", &c.outputBytes, 5 * 1024 * 1024, 1024, 50 * 1024 * 1024},
		{"PYTHON_RUNNER_MAX_EXECUTION_SECONDS", &c.executionSeconds, 600, 1, 3600},
		{"PYTHON_RUNNER_MAX_CONCURRENT_EXECUTIONS", &c.concurrentExecutions, 4, 1, 32},
	} {
		value := env.fallback
		if raw := get(env.name); raw != "" {
			parsed, err := strconv.Atoi(raw)
			if err != nil || parsed < env.min || parsed > env.max {
				return c, fmt.Errorf("%s must be an integer between %d and %d", env.name, env.min, env.max)
			}
			value = parsed
		}
		*env.target = value
	}
	var err error
	if c.dataDir, err = filepath.Abs(c.dataDir); err != nil {
		return c, err
	}
	c.logDir, err = filepath.Abs(c.logDir)
	return c, err
}

func prepareDirectories(c config) error {
	for _, dir := range []string{c.dataDir, c.logDir} {
		if err := os.MkdirAll(dir, 0700); err != nil {
			return err
		}
	}
	return nil
}
