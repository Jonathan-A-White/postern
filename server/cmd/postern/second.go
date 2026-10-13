package main

import (
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"

	"github.com/Jonathan-A-White/postern/server/internal/setup"
)

// runSetup is `postern setup --addr host:port --issuer <pubkey>`
// (docs/second-backend.md): the backend for the current user. It returns the
// process's exit code.
func runSetup(args []string, home, binary string, deps setup.Deps, errOut io.Writer) int {
	fs := flag.NewFlagSet("postern setup", flag.ContinueOnError)
	fs.SetOutput(errOut)
	opts := setup.Options{Home: home, Binary: binary}
	fs.StringVar(&opts.Addr, "addr", "", "host:port this user's backend listens on, e.g. 10.88.0.2:8788 (required)")
	fs.StringVar(&opts.Issuer, "issuer", "", "the licence issuer's compressed public key, hex: the key that signs the licences this backend accepts (required)")
	fs.StringVar(&opts.Apps, "apps", setup.DefaultApps, "POSTERN_APPS: collection=app pairs the mill opens the grist door to")
	fs.StringVar(&opts.Anchor, "anchor", setup.DefaultAnchor, "POSTERN_ANCHOR: the anchor address to poll")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	if opts.Addr == "" || opts.Issuer == "" {
		fmt.Fprintln(errOut, "postern setup: --addr and --issuer are both required")
		fs.Usage()
		return 2
	}
	if _, err := setup.Run(opts, deps); err != nil {
		fmt.Fprintf(errOut, "postern setup: %v\n", err)
		return 1
	}
	return 0
}

// runKeygen is `postern keygen --out FILE`: a fresh testnet key as a 0600 WIF
// file, in mw's key file format, and its public half on out.
func runKeygen(args []string, out, errOut io.Writer) int {
	fs := flag.NewFlagSet("postern keygen", flag.ContinueOnError)
	fs.SetOutput(errOut)
	path := fs.String("out", "", "where to write the private key, WIF, 0600; refuses a file that is there (required)")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	if *path == "" {
		fmt.Fprintln(errOut, "postern keygen: --out is required (the private key is never printed)")
		return 2
	}
	key, err := setup.WriteKey(*path)
	if err != nil {
		fmt.Fprintf(errOut, "postern keygen: %v\n", err)
		return 1
	}
	fmt.Fprintln(out, key.Public())
	return 0
}

// setupMain runs `postern setup` for the user running it, starting the unit
// through systemctl --user.
func setupMain(args []string) int {
	home, err := os.UserHomeDir()
	if err != nil {
		fmt.Fprintf(os.Stderr, "postern setup: %v\n", err)
		return 1
	}
	binary, err := os.Executable()
	if err != nil {
		fmt.Fprintf(os.Stderr, "postern setup: %v\n", err)
		return 1
	}
	deps := setup.Deps{
		Out: os.Stdout,
		Systemctl: func(args ...string) error {
			cmd := exec.Command("systemctl", args...)
			cmd.Stdout, cmd.Stderr = os.Stderr, os.Stderr
			return cmd.Run()
		},
	}
	return runSetup(args, home, binary, deps, os.Stderr)
}
