package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"

	"github.com/Jonathan-A-White/postern/server/internal/api"
	"github.com/Jonathan-A-White/postern/server/internal/config"
)

// runRights is `postern rights --json [--env-file F]`: the backend's licence
// map, collection by collection, from the same configuration the server loads
// (POSTERN_COLLECTIONS, POSTERN_APPS, their defaults) and the gate's own
// table (api.LicenceMap). It reads the env file and nothing else: no server
// starts, no key is read, nothing is written, and only collection names, app
// names and routes are printed. getenv is the environment used without
// --env-file. It returns the process's exit code.
func runRights(args []string, getenv func(string) string, out, errOut io.Writer) int {
	fs := flag.NewFlagSet("postern rights", flag.ContinueOnError)
	fs.SetOutput(errOut)
	asJSON := fs.Bool("json", false, "print the map as JSON: {\"collections\":[{collection, kind (cockpit|app), app, routes}]}")
	envFile := fs.String("env-file", "", "an EnvironmentFile (KEY=value lines) to read the configuration from instead of the environment")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	if *envFile != "" {
		f, err := os.Open(*envFile)
		if err != nil {
			fmt.Fprintf(errOut, "postern rights: %v\n", err)
			return 1
		}
		env, err := config.ParseEnvFile(f)
		f.Close()
		if err != nil {
			fmt.Fprintf(errOut, "postern rights: %s: %v\n", *envFile, err)
			return 1
		}
		getenv = func(key string) string { return env[key] }
	}
	cfg, err := config.Load(getenv)
	if err != nil {
		fmt.Fprintf(errOut, "postern rights: loading config: %v\n", err)
		return 1
	}
	licences := api.LicenceMap(cfg.Collections, cfg.AppCollections, cfg.Apps)
	if *asJSON {
		enc := json.NewEncoder(out)
		enc.SetIndent("", "  ")
		if err := enc.Encode(struct {
			Collections []api.CollectionRights `json:"collections"`
		}{licences}); err != nil {
			fmt.Fprintf(errOut, "postern rights: %v\n", err)
			return 1
		}
		return 0
	}
	for _, l := range licences {
		kind := l.Kind
		if l.App != "" {
			kind += " " + l.App
		}
		fmt.Fprintf(out, "%s: %s\n", l.Collection, kind)
		for _, route := range l.Routes {
			fmt.Fprintf(out, "  %s\n", route)
		}
	}
	return 0
}
