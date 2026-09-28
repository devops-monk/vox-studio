//! Finder integration: files opened with VoxStudio ("Open With", double-click, drag onto the Dock
//! icon) and Quick Actions in Finder's right-click menu ("Dub with VoxStudio", …).
//!
//! Both end up as `voxstudio://files?action=…&path=…` links, which the UI handles like a drop.

use std::path::{Path, PathBuf};

use tauri::Url;

/// A `voxstudio://files` link for some local paths; `action` is empty to let the user choose.
pub fn files_link(paths: &[PathBuf], action: &str) -> Option<String> {
    if paths.is_empty() {
        return None;
    }
    let mut url = Url::parse("voxstudio://files").ok()?;
    {
        let mut q = url.query_pairs_mut();
        if !action.is_empty() {
            q.append_pair("action", action);
        }
        for p in paths {
            q.append_pair("path", &p.to_string_lossy());
        }
    }
    Some(url.to_string())
}

/// Command-line arguments that are existing files (Windows/Linux "Open with", second launches).
pub fn paths_in_args(args: &[String]) -> Vec<PathBuf> {
    args.iter()
        .skip(1)
        .filter(|a| !a.starts_with('-') && !a.starts_with("voxstudio://"))
        .map(PathBuf::from)
        .filter(|p| p.is_file())
        .collect()
}

struct QuickAction {
    name: &'static str,
    action: &'static str,
    /// Uniform type identifiers the action shows up for.
    types: &'static [&'static str],
    input: &'static str,
}

const ACTIONS: &[QuickAction] = &[
    QuickAction { name: "Dub with VoxStudio", action: "dub", types: &["public.movie"], input: "com.apple.Automator.fileSystemObject.movie" },
    QuickAction { name: "Transcribe with VoxStudio", action: "transcribe", types: &["public.audiovisual-content"], input: "com.apple.Automator.fileSystemObject" },
    QuickAction { name: "Clean Up with VoxStudio", action: "clean", types: &["public.audio"], input: "com.apple.Automator.fileSystemObject" },
    QuickAction {
        name: "Make Audiobook with VoxStudio",
        action: "audiobook",
        types: &["org.idpf.epub-container", "org.openxmlformats.wordprocessingml.document", "public.plain-text", "net.daringfireball.markdown"],
        input: "com.apple.Automator.fileSystemObject",
    },
];

fn services_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Services"))
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// The shell script each Quick Action runs: URL-encode the selected files (with JavaScript for
/// Automation, which every Mac has) and open a voxstudio:// link.
fn script(action: &str) -> String {
    format!(
        r#"url="voxstudio://files?action={action}"
for f in "$@"; do
  url="$url&path=$(/usr/bin/osascript -l JavaScript -e 'function run(a) {{ return encodeURIComponent(a[0]) }}' "$f")"
done
/usr/bin/open "$url""#
    )
}

fn info_plist(qa: &QuickAction) -> String {
    let types: String = qa.types.iter().map(|t| format!("<string>{t}</string>")).collect();
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleName</key><string>{name}</string>
	<key>CFBundleIdentifier</key><string>com.voxstudio.app.finder.{action}</string>
	<key>NSServices</key>
	<array>
		<dict>
			<key>NSMenuItem</key><dict><key>default</key><string>{name}</string></dict>
			<key>NSMessage</key><string>runWorkflowAsService</string>
			<key>NSRequiredContext</key><dict><key>NSApplicationIdentifier</key><string>com.apple.finder</string></dict>
			<key>NSSendFileTypes</key><array>{types}</array>
		</dict>
	</array>
</dict>
</plist>
"#,
        name = xml_escape(qa.name),
        action = qa.action,
    )
}

fn document_wflow(qa: &QuickAction) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>AMApplicationBuild</key><string>523</string>
	<key>AMApplicationVersion</key><string>2.10</string>
	<key>AMDocumentVersion</key><string>2</string>
	<key>actions</key>
	<array>
		<dict>
			<key>action</key>
			<dict>
				<key>AMAccepts</key>
				<dict>
					<key>Container</key><string>List</string>
					<key>Optional</key><true/>
					<key>Types</key><array><string>com.apple.cocoa.string</string></array>
				</dict>
				<key>AMActionVersion</key><string>2.0.3</string>
				<key>AMApplication</key><array><string>Automator</string></array>
				<key>AMParameterProperties</key>
				<dict>
					<key>COMMAND_STRING</key><dict/>
					<key>CheckedForUserDefaultShell</key><dict/>
					<key>inputMethod</key><dict/>
					<key>shell</key><dict/>
					<key>source</key><dict/>
				</dict>
				<key>AMProvides</key>
				<dict>
					<key>Container</key><string>List</string>
					<key>Types</key><array><string>com.apple.cocoa.string</string></array>
				</dict>
				<key>ActionBundlePath</key><string>/System/Library/Automator/Run Shell Script.action</string>
				<key>ActionName</key><string>Run Shell Script</string>
				<key>ActionParameters</key>
				<dict>
					<key>COMMAND_STRING</key><string>{script}</string>
					<key>CheckedForUserDefaultShell</key><true/>
					<key>inputMethod</key><integer>1</integer>
					<key>shell</key><string>/bin/zsh</string>
					<key>source</key><string></string>
				</dict>
				<key>BundleIdentifier</key><string>com.apple.RunShellScript</string>
				<key>CFBundleVersion</key><string>2.0.3</string>
				<key>CanShowSelectedItemsWhenRun</key><false/>
				<key>CanShowWhenRun</key><true/>
				<key>Category</key><array><string>AMCategoryUtilities</string></array>
				<key>Class Name</key><string>RunShellScriptAction</string>
				<key>InputUUID</key><string>6C1D5B5A-0F1B-4E7B-9D6E-0B1A7C2F3E01</string>
				<key>Keywords</key><array><string>Shell</string><string>Script</string></array>
				<key>OutputUUID</key><string>6C1D5B5A-0F1B-4E7B-9D6E-0B1A7C2F3E02</string>
				<key>UUID</key><string>6C1D5B5A-0F1B-4E7B-9D6E-0B1A7C2F3E03</string>
				<key>UnlocalizedApplications</key><array><string>Automator</string></array>
				<key>arguments</key><dict/>
				<key>isViewVisible</key><integer>1</integer>
				<key>location</key><string>309.5:305.0</string>
				<key>nibPath</key><string>/System/Library/Automator/Run Shell Script.action/Contents/Resources/Base.lproj/main.nib</string>
			</dict>
			<key>isViewVisible</key><integer>1</integer>
		</dict>
	</array>
	<key>connectors</key><dict/>
	<key>workflowMetaData</key>
	<dict>
		<key>serviceApplicationBundleID</key><string>com.apple.finder</string>
		<key>serviceApplicationPath</key><string>/System/Library/CoreServices/Finder.app</string>
		<key>serviceInputTypeIdentifier</key><string>{input}</string>
		<key>serviceOutputTypeIdentifier</key><string>com.apple.Automator.nothing</string>
		<key>serviceProcessesInput</key><integer>0</integer>
		<key>workflowTypeIdentifier</key><string>com.apple.Automator.servicesMenu</string>
	</dict>
</dict>
</plist>
"#,
        script = xml_escape(&script(qa.action)),
        input = qa.input,
    )
}

/// Write the Quick Actions into `dir` (normally ~/Library/Services). Returns their names.
pub fn install_into(dir: &Path) -> Result<Vec<String>, String> {
    let mut names = Vec::new();
    for qa in ACTIONS {
        let contents = dir.join(format!("{}.workflow", qa.name)).join("Contents");
        std::fs::create_dir_all(&contents).map_err(|e| e.to_string())?;
        std::fs::write(contents.join("Info.plist"), info_plist(qa)).map_err(|e| e.to_string())?;
        std::fs::write(contents.join("document.wflow"), document_wflow(qa)).map_err(|e| e.to_string())?;
        names.push(qa.name.to_string());
    }
    Ok(names)
}

pub fn install() -> Result<Vec<String>, String> {
    let dir = services_dir().ok_or("No home folder")?;
    let names = install_into(&dir)?;
    refresh_services();
    Ok(names)
}

pub fn uninstall() -> Result<(), String> {
    let dir = services_dir().ok_or("No home folder")?;
    for qa in ACTIONS {
        let path = dir.join(format!("{}.workflow", qa.name));
        if path.exists() {
            std::fs::remove_dir_all(&path).map_err(|e| e.to_string())?;
        }
    }
    refresh_services();
    Ok(())
}

pub fn installed() -> bool {
    services_dir().is_some_and(|d| ACTIONS.iter().all(|qa| d.join(format!("{}.workflow", qa.name)).exists()))
}

/// Ask macOS to re-read the Services menu so the actions appear without logging out.
fn refresh_services() {
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("/System/Library/CoreServices/pbs").arg("-update").status();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn links_encode_paths_and_action() {
        let link = files_link(&[PathBuf::from("/Users/me/My Video & more.mov")], "dub").unwrap();
        assert_eq!(link, "voxstudio://files?action=dub&path=%2FUsers%2Fme%2FMy+Video+%26+more.mov");
        assert!(files_link(&[], "dub").is_none());
    }

    /// `VOXSTUDIO_QA_DIR=/some/dir cargo test export_for_manual_check` writes the actions there.
    #[test]
    fn export_for_manual_check() {
        if let Some(dir) = std::env::var_os("VOXSTUDIO_QA_DIR") {
            install_into(Path::new(&dir)).unwrap();
        }
    }

    #[test]
    fn writes_valid_plists() {
        let dir = std::env::temp_dir().join(format!("voxstudio-qa-{}", std::process::id()));
        let names = install_into(&dir).unwrap();
        assert_eq!(names.len(), ACTIONS.len());
        for name in names {
            let contents = dir.join(format!("{name}.workflow/Contents"));
            for file in ["Info.plist", "document.wflow"] {
                let status = std::process::Command::new("plutil").arg("-lint").arg(contents.join(file)).output();
                if let Ok(out) = status {
                    assert!(out.status.success(), "{file} of {name}: {}", String::from_utf8_lossy(&out.stdout));
                }
            }
        }
        let _ = std::fs::remove_dir_all(dir);
    }
}
