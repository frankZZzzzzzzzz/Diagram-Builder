# Built with Codex for Handshake's Codex Creator Challenge
# Diagram Builder

Diagram Builder is a local web app for creating simple diagrams with drag-and-drop boxes and arrows.

## Features

- Drag a box preview onto a canvas
- Move boxes freely
- Connect boxes with arrows
- Edit title and description for the selected box
- Change the selected box with preset colors or a custom color picker
- Delete boxes and connected arrows
- Delete a box by pressing `Delete` or dragging it off the canvas
- Autosave to local browser storage
- Save diagrams as JSON files
- Load diagrams from JSON files

## Run It
Website:
https://singular-faun-ddd92b.netlify.app/

OR

From this folder:

```powershell
python app.py
```

Then open:

```text
http://127.0.0.1:8000
```

## How To Use

- Drag the box preview from the palette into the canvas
- Click a box to edit its text in the sidebar
- Apply a preset color or choose a custom color for the selected box
- Click `Connect Boxes`, then click one box and another to create an arrow
- Press `Delete` to remove the selected box
- Drag a box off the canvas to delete it
- Click `Save Diagram` to download a `.json` file
- Click `Load Diagram` to restore a saved file

## Notes

- The app uses only Python's standard library and browser JavaScript.
- Autosave is stored in the browser with `localStorage`.
