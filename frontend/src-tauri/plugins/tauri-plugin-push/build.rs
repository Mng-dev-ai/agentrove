const COMMANDS: &[&str] = &[
    "register",
    "take_launch_path",
    "register_listener",
    "remove_listener",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).ios_path("ios").build();
}
