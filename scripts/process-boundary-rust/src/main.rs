//! Read-only AST discovery: target source is never compiled or executed.
use serde_json::{json, Value};
use std::collections::{BTreeSet, HashMap};
use std::io::{Read, Write};
use syn::spanned::Spanned;
use syn::visit::{self, Visit};

const BUDGET: usize = 8 * 1024 * 1024;

fn interesting(name: &str) -> bool {
    matches!(
        name,
        "new"
            | "spawn"
            | "spawn_command"
            | "spawn_blocking"
            | "spawn_pty"
            | "output"
            | "status"
            | "exec"
            | "connect"
            | "connect_timeout"
            | "connect_ipc"
            | "bind"
            | "listen"
            | "openpty"
            | "fork"
            | "posix_spawn"
            | "posix_spawnp"
            | "CreateProcessW"
            | "CreateProcessA"
            | "CreateNamedPipeW"
            | "CreateNamedPipeA"
            | "CreatePipe"
            | "ConnectNamedPipe"
            | "GetNamedPipeServerProcessId"
            | "ShellExecuteW"
    )
}

#[derive(Default)]
struct Imports {
    aliases: HashMap<String, BTreeSet<String>>,
}

impl Imports {
    fn bind(&mut self, name: String, path: String) {
        self.aliases.entry(name).or_default().insert(path);
    }

    fn tree(&mut self, prefix: &[String], tree: &syn::UseTree) {
        match tree {
            syn::UseTree::Path(part) => {
                let mut next = prefix.to_vec();
                next.push(part.ident.to_string());
                self.tree(&next, &part.tree);
            }
            syn::UseTree::Name(part) => {
                let mut target = prefix.to_vec();
                if part.ident != "self" {
                    target.push(part.ident.to_string());
                }
                let name = target.last().cloned().unwrap_or_default();
                self.bind(name, target.join("::"));
            }
            syn::UseTree::Rename(part) => {
                let mut target = prefix.to_vec();
                target.push(part.ident.to_string());
                self.bind(part.rename.to_string(), target.join("::"));
            }
            syn::UseTree::Group(group) => {
                for item in &group.items {
                    self.tree(prefix, item);
                }
            }
            syn::UseTree::Glob(_) => {}
        }
    }
}

impl<'ast> Visit<'ast> for Imports {
    fn visit_item_use(&mut self, item: &'ast syn::ItemUse) {
        self.tree(&[], &item.tree);
        visit::visit_item_use(self, item);
    }
}

struct Discovery<'a> {
    file: &'a str,
    aliases: HashMap<String, BTreeSet<String>>,
    rows: Vec<Value>,
}

impl Discovery<'_> {
    fn add(&mut self, span: proc_macro2::Span, kind: &str, capability: String) {
        let point = span.start();
        self.rows
            .push(json!({"file":self.file,"line":point.line.max(1),
            "column":point.column + 1,"kind":kind,"capability":capability}));
    }

    fn paths(&self, path: &syn::Path) -> BTreeSet<String> {
        let parts: Vec<_> = path
            .segments
            .iter()
            .map(|part| part.ident.to_string())
            .collect();
        let Some(first) = parts.first() else {
            return BTreeSet::new();
        };
        let suffix = parts[1..].join("::");
        match self.aliases.get(first) {
            Some(targets) => targets
                .iter()
                .map(|target| {
                    if suffix.is_empty() {
                        target.clone()
                    } else {
                        format!("{target}::{suffix}")
                    }
                })
                .collect(),
            None => [parts.join("::")].into_iter().collect(),
        }
    }
}

impl<'ast> Visit<'ast> for Discovery<'_> {
    fn visit_item_use(&mut self, item: &'ast syn::ItemUse) {
        self.add(
            item.span(),
            "source-review",
            "rust-use-delegation".to_owned(),
        );
        visit::visit_item_use(self, item);
    }

    fn visit_local(&mut self, local: &'ast syn::Local) {
        if let (syn::Pat::Ident(binding), Some(initializer)) = (&local.pat, &local.init) {
            if let syn::Expr::Path(target) = initializer.expr.as_ref() {
                let paths = self.paths(&target.path);
                let entry = self.aliases.entry(binding.ident.to_string()).or_default();
                // A by-name union over-approximates lexical shadowing. A large
                // or recursive alias set stays opaque rather than being dropped.
                if entry.len() + paths.len() <= 64 {
                    entry.extend(paths);
                } else {
                    self.add(local.span(), "source-review", "rust-alias-limit".to_owned());
                }
            }
        } else {
            self.add(
                local.span(),
                "source-review",
                "rust-binding-storage".to_owned(),
            );
        }
        visit::visit_local(self, local);
    }

    fn visit_expr_call(&mut self, call: &'ast syn::ExprCall) {
        if let syn::Expr::Path(target) = call.func.as_ref() {
            for target in self.paths(&target.path) {
                let name = target.rsplit("::").next().unwrap_or_default();
                let (kind, prefix) = if interesting(name) {
                    ("call", "rust:")
                } else {
                    ("source-review", "rust-call-delegation:")
                };
                self.add(call.span(), kind, format!("{prefix}{target}"));
            }
        } else {
            self.add(
                call.span(),
                "source-review",
                "rust-indirect-call".to_owned(),
            );
        }
        visit::visit_expr_call(self, call);
    }

    fn visit_expr_method_call(&mut self, call: &'ast syn::ExprMethodCall) {
        let name = call.method.to_string();
        let (kind, prefix) = if interesting(&name) {
            ("call", "rust-method:")
        } else {
            ("source-review", "rust-method-delegation:")
        };
        self.add(call.span(), kind, format!("{prefix}{name}"));
        visit::visit_expr_method_call(self, call);
    }

    fn visit_expr_path(&mut self, reference: &'ast syn::ExprPath) {
        for target in self.paths(&reference.path) {
            if interesting(target.rsplit("::").next().unwrap_or_default()) {
                self.add(reference.span(), "escape", format!("rust:{target}"));
            }
        }
        visit::visit_expr_path(self, reference);
    }

    fn visit_macro(&mut self, mac: &'ast syn::Macro) {
        let name = mac
            .path
            .segments
            .iter()
            .map(|part| part.ident.to_string())
            .collect::<Vec<_>>()
            .join("::");
        self.add(mac.span(), "source-review", format!("rust-macro:{name}"));
        // Never expand macros. Generated calls need a separate proof; string
        // contents and token text are not mistaken for executed invocations.
        visit::visit_macro(self, mac);
    }

    fn visit_attribute(&mut self, attribute: &'ast syn::Attribute) {
        let name = attribute
            .path()
            .segments
            .iter()
            .map(|part| part.ident.to_string())
            .collect::<Vec<_>>()
            .join("::");
        self.add(
            attribute.span(),
            "source-review",
            format!("rust-attribute:{name}"),
        );
        visit::visit_attribute(self, attribute);
    }
}

fn scan(file: &str, source: &str) -> Vec<Value> {
    let parsed = match syn::parse_file(source) {
        Ok(parsed) => parsed,
        Err(error) => {
            let point = error.span().start();
            return vec![
                json!({"file":file,"line":point.line.max(1),"column":point.column+1,
                "kind":"source-review","capability":"rust-parse-error"}),
            ];
        }
    };
    let mut imports = Imports::default();
    imports.visit_file(&parsed);
    let mut discovery = Discovery {
        file,
        aliases: imports.aliases,
        rows: Vec::new(),
    };
    discovery.visit_file(&parsed);
    if discovery.rows.is_empty() {
        discovery.add(
            proc_macro2::Span::call_site(),
            "source-review",
            "rust-no-classified-capabilities".to_owned(),
        );
    }
    discovery.rows
}

fn process_input(input: &str) -> Result<String, String> {
    if input.len() > BUDGET {
        return Err("Rust parser input budget exceeded".to_owned());
    }
    let documents: Value =
        serde_json::from_str(input).map_err(|_| "Rust parser input is not JSON")?;
    let documents = documents
        .as_array()
        .ok_or("Rust parser input must be an array")?;
    let mut rows = Vec::new();
    for document in documents {
        let file = document["file"]
            .as_str()
            .ok_or("Rust parser file must be a string")?;
        let source = document["source"]
            .as_str()
            .ok_or("Rust parser source must be a string")?;
        rows.extend(scan(file, source));
    }
    let response = json!({"schemaVersion":1,"parserSource":include_str!("main.rs"),
        "parserManifest":include_str!("../Cargo.toml"),"parserLock":include_str!("../Cargo.lock"),"rows":rows});
    let output =
        serde_json::to_string(&response).map_err(|_| "Rust parser output serialization failed")?;
    if output.len() > BUDGET {
        return Err("Rust parser output budget exceeded".to_owned());
    }
    Ok(output)
}

fn run() -> Result<(), String> {
    let mut input = String::new();
    std::io::stdin()
        .take((BUDGET + 1) as u64)
        .read_to_string(&mut input)
        .map_err(|_| "Rust parser input read failed")?;
    let output = process_input(&input)?;
    std::io::stdout()
        .write_all(output.as_bytes())
        .map_err(|_| "Rust parser output write failed")?;
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn contains(rows: &[Value], kind: &str, capability: &str) -> bool {
        rows.iter().any(|row| {
            row["kind"] == kind
                && row["capability"]
                    .as_str()
                    .unwrap_or_default()
                    .contains(capability)
        })
    }

    #[test]
    fn renamed_commands_and_native_methods_are_individual_records() {
        let rows = scan(
            "src-tauri/a.rs",
            r#"
            use std::process::Command as Launch;
            fn run() { let mut child = Launch::new("tool"); child.spawn(); child.output(); }
        "#,
        );
        assert!(contains(&rows, "call", "std::process::Command::new"));
        assert!(contains(&rows, "call", "method:spawn"));
        assert!(contains(&rows, "call", "method:output"));
    }

    #[test]
    fn unix_tcp_and_windows_pipe_calls_are_visible_without_host_cfg_filtering() {
        let rows = scan(
            "src-tauri/endpoints.rs",
            r#"
            #[cfg(unix)] fn unix() { std::os::unix::net::UnixListener::bind("fixture.sock"); }
            #[cfg(windows)] fn windows() { unsafe { CreateNamedPipeW(name, flags); } }
            fn tcp() { std::net::TcpStream::connect_timeout(&address, timeout); }
        "#,
        );
        for target in [
            "UnixListener::bind",
            "CreateNamedPipeW",
            "TcpStream::connect_timeout",
        ] {
            assert!(contains(&rows, "call", target), "{target}");
        }
    }

    #[test]
    fn command_function_aliases_and_indirect_storage_are_not_lost() {
        let rows = scan(
            "src-tauri/indirect.rs",
            r#"
            use std::process::Command;
            fn run() { let make = Command::new; make("tool"); let makers = [Command::new]; makers[0]("tool"); }
        "#,
        );
        assert!(contains(&rows, "call", "std::process::Command::new"));
        assert!(contains(&rows, "escape", "std::process::Command::new"));
        assert!(contains(&rows, "source-review", "indirect-call"));
    }

    #[test]
    fn macros_and_dynamic_delegation_remain_unverified_obligations() {
        let rows = scan(
            "src-tauri/macros.rs",
            r#"
            macro_rules! launch { () => { std::process::Command::new("tool").spawn() } }
            fn run() { launch!(); wrapper("tool"); }
        "#,
        );
        assert!(contains(&rows, "source-review", "rust-macro:launch"));
        assert!(contains(
            &rows,
            "source-review",
            "rust-call-delegation:wrapper"
        ));
    }

    #[test]
    fn comments_and_raw_strings_are_not_invocations() {
        let rows = scan("src-tauri/inert.rs", "// Command::new(\"tool\").spawn()\nfn data() { let _ = r###\"Command::new(\"tool\").spawn()\"###; }");
        assert!(rows.iter().all(|row| row["kind"] != "call"));
        assert!(
            !rows.is_empty(),
            "unclassified source must stay in the denominator"
        );
    }

    #[test]
    fn malformed_rust_is_an_explicit_obligation() {
        assert!(contains(
            &scan("src-tauri/broken.rs", "fn broken("),
            "source-review",
            "rust-parse-error"
        ));
    }

    #[test]
    fn target_file_operations_are_never_executed() {
        let target =
            std::env::temp_dir().join(format!("cave-6303-not-executed-{}", std::process::id()));
        assert!(!target.exists());
        let rows = scan(
            "src-tauri/side-effect.rs",
            &format!(
                "fn run() {{ std::fs::write({:?}, b\"not executed\"); }}",
                target
            ),
        );
        assert!(!rows.is_empty());
        assert!(!target.exists());
    }

    #[test]
    fn protocol_is_bounded_and_invalid_input_fails() {
        assert!(process_input("not JSON").is_err());
        assert!(process_input(&" ".repeat(8 * 1024 * 1024 + 1)).is_err());
        let response: Value = serde_json::from_str(
            &process_input(&json!([{"file":"src-tauri/a.rs","source":"fn main() {}"}]).to_string())
                .unwrap(),
        )
        .unwrap();
        assert_eq!(response["schemaVersion"], 1);
        assert_eq!(response["parserSource"], include_str!("main.rs"));
        assert!(response["rows"]
            .as_array()
            .unwrap()
            .iter()
            .all(|row| row["file"] == "src-tauri/a.rs"));
    }
}
