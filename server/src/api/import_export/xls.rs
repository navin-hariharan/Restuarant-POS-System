//! Minimal Excel 97-2003 (.xls, BIFF8) writer: one worksheet of text,
//! numbers and booleans, stored in an OLE compound file.

use super::export::Cell;

const SECTOR: usize = 512;
const END_OF_CHAIN: u32 = 0xFFFF_FFFE;
const FREE: u32 = 0xFFFF_FFFF;
const FAT_SECT: u32 = 0xFFFF_FFFD;
const NO_STREAM: u32 = 0xFFFF_FFFF;
/// Largest record body before a CONTINUE record is needed.
const MAX_RECORD: usize = 8224;
/// Cell format index used for every cell (the first cell XF).
const XF_CELL: u16 = 15;

pub const MAX_ROWS: usize = 65_536;
pub const MAX_COLS: usize = 256;

fn record(out: &mut Vec<u8>, id: u16, body: &[u8]) {
    out.extend_from_slice(&id.to_le_bytes());
    out.extend_from_slice(&(body.len() as u16).to_le_bytes());
    out.extend_from_slice(body);
}

fn utf16(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}

/// BOF record of the globals (0x0005) or a worksheet (0x0010).
fn bof(out: &mut Vec<u8>, kind: u16) {
    let mut b = Vec::with_capacity(16);
    for v in [0x0600u16, kind, 0x0DBB, 0x07CC] {
        b.extend_from_slice(&v.to_le_bytes());
    }
    b.extend_from_slice(&0x0000_0041u32.to_le_bytes());
    b.extend_from_slice(&0x0000_0006u32.to_le_bytes());
    record(out, 0x0809, &b);
}

fn font(out: &mut Vec<u8>) {
    let mut b = Vec::new();
    for v in [200u16, 0, 0x7FFF, 400, 0] {
        b.extend_from_slice(&v.to_le_bytes());
    }
    b.extend_from_slice(&[0, 0, 0, 0]);
    let name = utf16("Arial");
    b.push(name.len() as u8);
    b.push(1);
    for c in name {
        b.extend_from_slice(&c.to_le_bytes());
    }
    record(out, 0x0031, &b);
}

fn xf(out: &mut Vec<u8>, style: bool) {
    let mut b = Vec::with_capacity(20);
    b.extend_from_slice(&0u16.to_le_bytes()); // font
    b.extend_from_slice(&0u16.to_le_bytes()); // number format: General
    b.extend_from_slice(&(if style { 0xFFF5u16 } else { 0x0001 }).to_le_bytes());
    b.push(0x20); // bottom aligned
    b.push(0);
    b.push(0);
    b.push(if style { 0xF4 } else { 0x00 });
    b.extend_from_slice(&0u32.to_le_bytes());
    b.extend_from_slice(&0u32.to_le_bytes());
    b.extend_from_slice(&0x20C0u16.to_le_bytes());
    record(out, 0x00E0, &b);
}

/// Shared string table with CONTINUE records; returns the EXTSST body.
fn sst(out: &mut Vec<u8>, strings: &[Vec<u16>], total_refs: u32) -> Vec<u8> {
    let bucket = (strings.len() / 128 + 1).max(8);
    let mut ext = Vec::new();
    ext.extend_from_slice(&(bucket as u16).to_le_bytes());

    // records are assembled as (id, body) and flushed when full
    let mut body: Vec<u8> = Vec::with_capacity(MAX_RECORD);
    body.extend_from_slice(&total_refs.to_le_bytes());
    body.extend_from_slice(&(strings.len() as u32).to_le_bytes());
    let mut id = 0x00FCu16;
    let flush = |out: &mut Vec<u8>, id: &mut u16, body: &mut Vec<u8>| {
        record(out, *id, body);
        body.clear();
        *id = 0x003C;
    };
    for (i, s) in strings.iter().enumerate() {
        // the 3-byte string header must not be split
        if body.len() + 3 + 2 > MAX_RECORD {
            flush(out, &mut id, &mut body);
        }
        if i % bucket == 0 {
            let pos = out.len() + 4 + body.len();
            ext.extend_from_slice(&(pos as u32).to_le_bytes());
            ext.extend_from_slice(&((body.len() + 4) as u16).to_le_bytes());
            ext.extend_from_slice(&0u16.to_le_bytes());
        }
        body.extend_from_slice(&(s.len() as u16).to_le_bytes());
        body.push(1);
        let mut rest: &[u16] = s;
        loop {
            let room = (MAX_RECORD - body.len()) / 2;
            let take = room.min(rest.len());
            for c in &rest[..take] {
                body.extend_from_slice(&c.to_le_bytes());
            }
            rest = &rest[take..];
            if rest.is_empty() {
                break;
            }
            flush(out, &mut id, &mut body);
            body.push(1); // the continued characters are UTF-16 too
        }
    }
    flush(out, &mut id, &mut body);
    ext
}

/// The BIFF8 workbook stream for one sheet named `sheet`.
fn workbook(sheet: &str, rows: &[Vec<Cell>]) -> Vec<u8> {
    // shared strings
    let mut index: std::collections::HashMap<&str, u32> = std::collections::HashMap::new();
    let mut strings: Vec<Vec<u16>> = Vec::new();
    let mut refs = 0u32;
    for row in rows {
        for c in row {
            if let Cell::Text(t) = c {
                refs += 1;
                if !index.contains_key(t.as_str()) {
                    index.insert(t.as_str(), strings.len() as u32);
                    // a string holds at most 32767 characters
                    let mut u = utf16(t);
                    u.truncate(32_767);
                    strings.push(u);
                }
            }
        }
    }

    let mut g = Vec::new();
    bof(&mut g, 0x0005);
    record(&mut g, 0x0042, &1200u16.to_le_bytes()); // code page: UTF-16
    let mut w1 = Vec::new();
    for v in [0u16, 0, 0x25BC, 0x1572, 0x0038, 0, 0, 1, 0x0258] {
        w1.extend_from_slice(&v.to_le_bytes());
    }
    record(&mut g, 0x003D, &w1);
    for _ in 0..5 {
        font(&mut g);
    }
    for i in 0..16 {
        xf(&mut g, i < 15);
    }
    record(&mut g, 0x0293, &[0x00, 0x80, 0x00, 0xFF]); // "Normal" style
    let boundsheet_at = g.len() + 4;
    let name = utf16(sheet);
    let mut bs = vec![0u8; 4];
    bs.extend_from_slice(&[0, 0, name.len() as u8, 1]);
    for c in &name {
        bs.extend_from_slice(&c.to_le_bytes());
    }
    record(&mut g, 0x0085, &bs);
    let ext = sst(&mut g, &strings, refs);
    record(&mut g, 0x00FF, &ext);
    record(&mut g, 0x000A, &[]);

    let sheet_pos = g.len() as u32;
    g[boundsheet_at..boundsheet_at + 4].copy_from_slice(&sheet_pos.to_le_bytes());

    bof(&mut g, 0x0010);
    let cols = rows.iter().map(Vec::len).max().unwrap_or(0);
    let mut dim = Vec::new();
    dim.extend_from_slice(&0u32.to_le_bytes());
    dim.extend_from_slice(&(rows.len() as u32).to_le_bytes());
    dim.extend_from_slice(&0u16.to_le_bytes());
    dim.extend_from_slice(&(cols as u16).to_le_bytes());
    dim.extend_from_slice(&0u16.to_le_bytes());
    record(&mut g, 0x0200, &dim);
    let mut w2 = Vec::new();
    for v in [0x06B6u16, 0, 0, 0x40, 0, 0, 0] {
        w2.extend_from_slice(&v.to_le_bytes());
    }
    w2.extend_from_slice(&0u32.to_le_bytes());
    record(&mut g, 0x023E, &w2);
    for (r, row) in rows.iter().enumerate() {
        for (c, cell) in row.iter().enumerate() {
            let mut b = Vec::with_capacity(14);
            b.extend_from_slice(&(r as u16).to_le_bytes());
            b.extend_from_slice(&(c as u16).to_le_bytes());
            b.extend_from_slice(&XF_CELL.to_le_bytes());
            match cell {
                Cell::Empty => continue,
                Cell::Text(t) => {
                    b.extend_from_slice(&index.get(t.as_str()).copied().unwrap_or(0).to_le_bytes());
                    record(&mut g, 0x00FD, &b);
                }
                Cell::Num(n) => {
                    b.extend_from_slice(&n.to_le_bytes());
                    record(&mut g, 0x0203, &b);
                }
                Cell::Bool(v) => {
                    b.extend_from_slice(&[*v as u8, 0]);
                    record(&mut g, 0x0205, &b);
                }
            }
        }
    }
    record(&mut g, 0x000A, &[]);
    g
}

fn dir_entry(out: &mut Vec<u8>, name: &str, kind: u8, child: u32, start: u32, size: u32) {
    let mut e = vec![0u8; 128];
    let n = utf16(name);
    for (i, c) in n.iter().enumerate().take(31) {
        e[i * 2..i * 2 + 2].copy_from_slice(&c.to_le_bytes());
    }
    let name_len = if name.is_empty() { 0 } else { (n.len().min(31) as u16 + 1) * 2 };
    e[64..66].copy_from_slice(&name_len.to_le_bytes());
    e[66] = kind;
    e[67] = if kind == 0 { 0 } else { 1 }; // black
    e[68..72].copy_from_slice(&NO_STREAM.to_le_bytes());
    e[72..76].copy_from_slice(&NO_STREAM.to_le_bytes());
    e[76..80].copy_from_slice(&child.to_le_bytes());
    e[116..120].copy_from_slice(&start.to_le_bytes());
    e[120..124].copy_from_slice(&size.to_le_bytes());
    out.extend_from_slice(&e);
}

/// Complete .xls file; None when the data is too large for the format.
pub fn write(sheet: &str, rows: &[Vec<Cell>]) -> Option<Vec<u8>> {
    if rows.len() > MAX_ROWS || rows.iter().any(|r| r.len() > MAX_COLS) {
        return None;
    }
    let mut stream = workbook(sheet, rows);
    let size = stream.len().max(4096); // smaller streams would belong in the mini stream
    stream.resize(size.div_ceil(SECTOR) * SECTOR, 0);
    let data_sectors = stream.len() / SECTOR;
    let mut fat_sectors = 1;
    while data_sectors + 1 + fat_sectors > fat_sectors * (SECTOR / 4) {
        fat_sectors += 1;
    }
    if fat_sectors > 109 {
        return None;
    }
    let dir_sector = data_sectors as u32;

    let mut out = Vec::with_capacity(SECTOR * (1 + data_sectors + 1 + fat_sectors));
    out.extend_from_slice(&[0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]);
    out.extend_from_slice(&[0u8; 16]);
    for v in [0x003Eu16, 0x0003, 0xFFFE, 0x0009, 0x0006] {
        out.extend_from_slice(&v.to_le_bytes());
    }
    out.extend_from_slice(&[0u8; 6]);
    out.extend_from_slice(&0u32.to_le_bytes()); // directory sectors (v3: 0)
    out.extend_from_slice(&(fat_sectors as u32).to_le_bytes());
    out.extend_from_slice(&dir_sector.to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes());
    out.extend_from_slice(&4096u32.to_le_bytes());
    out.extend_from_slice(&END_OF_CHAIN.to_le_bytes()); // mini FAT
    out.extend_from_slice(&0u32.to_le_bytes());
    out.extend_from_slice(&END_OF_CHAIN.to_le_bytes()); // DIFAT
    out.extend_from_slice(&0u32.to_le_bytes());
    for i in 0..109 {
        let v = if i < fat_sectors { dir_sector + 1 + i as u32 } else { FREE };
        out.extend_from_slice(&v.to_le_bytes());
    }

    out.extend_from_slice(&stream);

    dir_entry(&mut out, "Root Entry", 5, 1, END_OF_CHAIN, 0);
    dir_entry(&mut out, "Workbook", 2, NO_STREAM, 0, size as u32);
    dir_entry(&mut out, "", 0, NO_STREAM, 0, 0);
    dir_entry(&mut out, "", 0, NO_STREAM, 0, 0);

    let mut fat = Vec::with_capacity(fat_sectors * SECTOR / 4);
    for i in 0..data_sectors {
        fat.push(if i + 1 == data_sectors { END_OF_CHAIN } else { i as u32 + 1 });
    }
    fat.push(END_OF_CHAIN);
    fat.extend(std::iter::repeat_n(FAT_SECT, fat_sectors));
    fat.resize(fat_sectors * SECTOR / 4, FREE);
    for v in fat {
        out.extend_from_slice(&v.to_le_bytes());
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn readable_by_calamine() {
        use calamine::{Data, Reader, Xls};
        let long = "x".repeat(9000);
        let mut rows = vec![vec![Cell::Text("name".into()), Cell::Text("price".into()), Cell::Text("bar".into())]];
        for i in 0..3000 {
            rows.push(vec![Cell::Text(format!("Item {i} é")), Cell::Num(i as f64 + 0.5), Cell::Bool(i % 2 == 0)]);
        }
        rows.push(vec![Cell::Text(long.clone()), Cell::Empty, Cell::Bool(false)]);
        let bytes = write("Worksheet", &rows).unwrap();
        let mut wb = Xls::new(std::io::Cursor::new(bytes)).unwrap();
        assert_eq!(wb.sheet_names(), vec!["Worksheet".to_string()]);
        let range = wb.worksheet_range("Worksheet").unwrap();
        assert_eq!(range.height(), 3002);
        assert_eq!(range.get((0, 1)), Some(&Data::String("price".into())));
        assert_eq!(range.get((11, 0)), Some(&Data::String("Item 10 é".into())));
        assert_eq!(range.get((11, 1)), Some(&Data::Float(10.5)));
        assert_eq!(range.get((11, 2)), Some(&Data::Bool(true)));
        assert_eq!(range.get((3001, 0)), Some(&Data::String(long)));
    }
}
